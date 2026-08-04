export { EMBEDDING_DIMENSIONS, EmbeddingDbService };

import * as pg from "pg";
import type {
  EmbeddingChunk,
  EmbeddingMatch,
  SearchEmbeddingsParams,
} from "./types.js";

/*
 * Storage and nearest-neighbour search over embeddings.
 *
 * Important notes about this interface:
 *   * It does not resolve owners. Rows carry an opaque (owner_kind, owner_id),
 *     so a match tells you what to go read, not the record itself.
 *   * It does not filter soft-deleted owners. That filtering belongs to
 *     the caller that knows how to join the owning table.
 */

/*
 * The width `embeddings.embedding` is declared at in migration 012. The column
 * must match the TEI server embedding width or the embedding service will fail
 * to start.
 */
const EMBEDDING_DIMENSIONS = 1024;

class EmbeddingDbService {
  private _pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this._pool = pool;
  }

  /*
   * Store or refresh a single chunk. Re-embedding the same chunk overwrites it
   * in place.
   */
  async upsert_embedding(user_id: string, chunk: EmbeddingChunk): Promise<void> {
    await this._pool.query(
      `INSERT INTO embeddings
              (user_id, owner_kind, owner_id, chunk_index, content, embedding, model)
       VALUES ($1, $2, $3, $4, $5, $6::vector, $7)
       ON CONFLICT (owner_kind, owner_id, chunk_index) DO UPDATE SET
         user_id   = EXCLUDED.user_id,
         content   = EXCLUDED.content,
         embedding = EXCLUDED.embedding,
         model     = EXCLUDED.model`,
      [user_id, chunk.owner_kind, chunk.owner_id, chunk.chunk_index,
       chunk.content, _to_vector_literal(chunk.embedding), chunk.model]);
  }

  /*
   * Replace an owner's chunks in one transaction.
   *
   * This is the primitive to reach for when re-embedding a record. It handles
   * the case a plain upsert loop silently gets wrong: if the content
   * shrank then upserting chunks 0..2 would leave 3..9 in place. This correctly
   * handles deleting the tail inside the same transaction.
   *
   * Passing an empty `chunks` removes every chunk for the owner.
   *
   * chunk_index must cover 0..chunks.length-1 exactly, in any order. Throws
   * otherwise: the tail delete removes everything at or past chunks.length, so
   * a gap would silently delete a chunk this same call just wrote.
   */
  async replace_owner_embeddings(
    user_id: string,
    owner_kind: string,
    owner_id: string,
    chunks: EmbeddingChunk[],
  ): Promise<void> {
    const seen = new Set<number>();
    for (const chunk of chunks) {
      if (chunk.owner_kind !== owner_kind || chunk.owner_id !== owner_id) {
        throw new Error(
          `replace_owner_embeddings: chunk owner (${chunk.owner_kind}, `
          + `${chunk.owner_id}) does not match (${owner_kind}, ${owner_id})`);
      }
      if (!Number.isInteger(chunk.chunk_index)
          || chunk.chunk_index < 0
          || chunk.chunk_index >= chunks.length) {
        throw new Error(
          `replace_owner_embeddings: chunk_index ${chunk.chunk_index} is outside `
          + `0..${chunks.length - 1}; indices must cover the range exactly or the `
          + `tail delete would remove a chunk this call just wrote`);
      }
      if (seen.has(chunk.chunk_index)) {
        throw new Error(
          `replace_owner_embeddings: duplicate chunk_index ${chunk.chunk_index}; `
          + `indices must cover 0..${chunks.length - 1} exactly`);
      }
      seen.add(chunk.chunk_index);
    }
    const client = await this._pool.connect();
    try {
      await client.query("BEGIN");
      for (const chunk of chunks) {
        await client.query(
          `INSERT INTO embeddings
                  (user_id, owner_kind, owner_id, chunk_index, content, embedding, model)
           VALUES ($1, $2, $3, $4, $5, $6::vector, $7)
           ON CONFLICT (owner_kind, owner_id, chunk_index) DO UPDATE SET
             user_id   = EXCLUDED.user_id,
             content   = EXCLUDED.content,
             embedding = EXCLUDED.embedding,
             model     = EXCLUDED.model`,
          [user_id, owner_kind, owner_id, chunk.chunk_index,
           chunk.content, _to_vector_literal(chunk.embedding), chunk.model]);
      }
      await client.query(
        `DELETE FROM embeddings
          WHERE owner_kind = $1 AND owner_id = $2 AND chunk_index >= $3`,
        [owner_kind, owner_id, chunks.length]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /*
   * Nearest neighbours to a given embedding. Scoped to one user and one model.
   *
   * Ordered ascending by cosine distance (`<=>`) puts the closest match first.
   * min_similarity is applied outside the ordered subquery so it trims the
   * top-k rather than changing which k the index picks.
   */
  async search_embeddings(params: SearchEmbeddingsParams): Promise<EmbeddingMatch[]> {
    const limit = params.limit ?? _DEFAULT_SEARCH_LIMIT;
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error(`search_embeddings: limit must be a positive integer, got ${limit}`);
    }
    const result = await this._pool.query(
      `SELECT owner_kind, owner_id, chunk_index, content, similarity
         FROM (
           SELECT owner_kind, owner_id, chunk_index, content,
                  1 - (embedding <=> $2::vector) AS similarity
             FROM embeddings
            WHERE user_id = $1
              AND model = $3
              AND ($4::text[] IS NULL OR owner_kind = ANY($4))
            ORDER BY embedding <=> $2::vector
            LIMIT $5
         ) ranked
        WHERE similarity >= $6
        ORDER BY similarity DESC`,
      [params.user_id, _to_vector_literal(params.embedding), params.model,
       params.owner_kinds ?? null, limit, params.min_similarity ?? 0]);
    return result.rows;
  }

  /*
   * Remove every chunk for one owning record. Whoever writes vectors for a kind
   * is responsible for calling this when the owner is deleted.
   */
  async delete_by_owner(owner_kind: string, owner_id: string): Promise<number> {
    const result = await this._pool.query(
      "DELETE FROM embeddings WHERE owner_kind = $1 AND owner_id = $2",
      [owner_kind, owner_id]);
    return result.rowCount ?? 0;
  }

  /*
   * Remove every chunk produced by a model other than the given `model` for one
   * user. Convenient for retiring superseded model's vectors once a
   * re-embedding pass has written replacements.
   */
  async delete_superseded_models(user_id: string, model: string): Promise<number> {
    const result = await this._pool.query(
      "DELETE FROM embeddings WHERE user_id = $1 AND model <> $2",
      [user_id, model]);
    return result.rowCount ?? 0;
  }

  /*
   * How many chunks a user has stored per (owner_kind, model). Cheap enough to
   * poll while backfill runs to ensure progress is being made.
   */
  async count_by_kind(
    user_id: string
  ): Promise<{ owner_kind: string; model: string; count: number }[]> {
    const result = await this._pool.query(
      `SELECT owner_kind, model, count(*)::int AS count
         FROM embeddings
        WHERE user_id = $1
        GROUP BY owner_kind, model
        ORDER BY owner_kind, model`,
      [user_id]);
    return result.rows;
  }
}

/*
 * (number[]) => string
 * Render a vector in pgvector's text input format, "[1,2,3]".
 *
 * NaN and Infinity are rejected here rather than at the database. pgvector
 * refuses them, but only after the literal has been built, and the resulting
 * error does not say which element was bad.
 */
function _to_vector_literal(embedding: number[]): string {
  if (0 === embedding.length) {
    throw new Error("embedding vector is empty");
  }
  for (let i = 0; i < embedding.length; i++) {
    if (!Number.isFinite(embedding[i])) {
      throw new Error(
        `embedding vector element ${i} is not finite (${embedding[i]})`);
    }
  }
  return `[${embedding.join(",")}]`;
}

const _DEFAULT_SEARCH_LIMIT = 10;
