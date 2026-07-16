export { FileDbService };

import assert from "node:assert";
import * as pg from "pg";
import type { File, FileStatus } from "./types.js";

class FileDbService {
  private _pool: pg.Pool;
  constructor(pool: pg.Pool) {
    this._pool = pool;
  }

  async create_file_if_absent(
    id: string,
    user_id: string,
    chat_id: string,
    original_filename: string | null,
    mime_type: string,
    // TODO:[db] size_bytes is string on read and number on write
    size_bytes: number,
    checksum_sha256: string,
    storage_backend: string,
    storage_key: string,
    status: FileStatus,
    metadata: Record<string, unknown> = {},
  ): Promise<{ file: File; created: boolean }> {
    // Single CTE so the file insert, the dedup fallback, and the chat_files
    // attachment all land atomically.
    const result = await this._pool.query(
      `WITH ins AS (
         INSERT INTO files (id, user_id, original_filename, mime_type, size_bytes,
                            checksum_sha256, storage_backend, storage_key, status,
                            metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $11)
         ON CONFLICT (user_id, checksum_sha256) WHERE checksum_sha256 IS NOT NULL
           DO NOTHING
         RETURNING *, true AS created
       ),
       existing AS (
         SELECT *, false AS created FROM files
          WHERE user_id = $2 AND checksum_sha256 = $6
            AND NOT EXISTS (SELECT 1 FROM ins)
       ),
       combined AS (
         SELECT * FROM ins UNION ALL SELECT * FROM existing
       ),
       linked AS (
         INSERT INTO chat_files (chat_id, file_id)
         SELECT $10, id FROM combined
         ON CONFLICT DO NOTHING
       )
       SELECT * FROM combined`,
      [id, user_id, original_filename, mime_type, size_bytes,
       checksum_sha256, storage_backend, storage_key, status, chat_id,
       metadata]);
    assert(result.rows.length === 1);
    const { created, ...file } = result.rows[0];
    return { file: file as File, created };
  }

  async get_file_by_id(
    id: string, chat_id: string, user_id: string
  ): Promise<File | null> {
    const result = await this._pool.query(
      `SELECT f.* FROM files f
         JOIN chat_files cf ON cf.file_id = f.id
        WHERE f.id = $1 AND cf.chat_id = $2 AND f.user_id = $3`,
      [id, chat_id, user_id]);
    assert(result.rows.length <= 1);
    if (result.rows.length === 0) return null;
    return result.rows[0];
  }

  async update_file_status(
    id: string,
    status: FileStatus,
    parse_error: string | null = null
  ): Promise<void> {
    await this._pool.query(
      "UPDATE files SET status = $2, parse_error = $3 WHERE id = $1",
      [id, status, parse_error]);
  }

  async get_chat_files(chat_id: string, user_id: string): Promise<File[]> {
    const result = await this._pool.query(
      `SELECT f.* FROM files f
         JOIN chat_files cf ON cf.file_id = f.id
        WHERE cf.chat_id = $1 AND f.user_id = $2
        ORDER BY f.created_at DESC`,
      [chat_id, user_id]);
    return result.rows;
  }

  async get_files_by_ids(
    ids: string[], chat_id: string, user_id: string
  ): Promise<File[]> {
    // Scoped to the chat (via chat_files) and the user, matching the
    // existence semantics of get_file_by_id — ids the caller cannot see are
    // silently omitted rather than 404'd, so a partial result is normal.
    if (ids.length === 0) return [];
    const result = await this._pool.query(
      `SELECT f.* FROM files f
         JOIN chat_files cf ON cf.file_id = f.id
        WHERE f.id = ANY($1::uuid[])
          AND cf.chat_id = $2
          AND f.user_id = $3`,
      [ids, chat_id, user_id]);
    return result.rows;
  }
}
