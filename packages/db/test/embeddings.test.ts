// embeddings.test.ts
//
// Exercises EmbeddingDbService against the real schema in the scratch test
// database. Focuses on what lives in the SQL and the pgvector integration
// rather than the API surface.

import * as assert from "node:assert/strict";
import { after, beforeEach, describe, it } from "node:test";
import * as pg from "pg";
import { EMBEDDING_DIMENSIONS, make_db_services } from "db";
import { make_test_pool, reset_db } from "./harness.js";

const pool = make_test_pool();
const db = make_db_services(pool);

beforeEach(async () => {
  await reset_db(pool);
});
after(async () => {
  await db.close();
});

//------------------------------------------------------------------------------
// fixtures
//------------------------------------------------------------------------------

const MODEL = "test-model";

async function make_user(pool: pg.Pool, name: string): Promise<string> {
  const result = await pool.query(
    `INSERT INTO users (username, email, password_hash)
     VALUES ($1, $2, 'test-hash') RETURNING id`,
    [name, `${name}@example.test`]);
  return result.rows[0].id;
}

// Build a unit vector from a sparse {index: weight} spec, so tests can state
// the geometry they want and read the expected cosine straight off it.
function vec(spec: Record<number, number>): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const [index, weight] of Object.entries(spec)) v[Number(index)] = weight;
  const magnitude = Math.sqrt(v.reduce((sum, w) => sum + w * w, 0));
  assert.ok(magnitude > 0, "vec() spec must be non-zero");
  return v.map((w) => w / magnitude);
}

// Distinct directions: E0 and E1 are orthogonal, MID sits exactly
// between them.
const E0 = vec({ 0: 1 });
const E1 = vec({ 1: 1 });
const MID = vec({ 0: 1, 1: 1 });

function chunk(owner_id: string, overrides: Partial<{
  owner_kind: string; chunk_index: number; content: string;
  embedding: number[]; model: string;
}> = {}) {
  return {
    owner_kind: overrides.owner_kind ?? "note",
    owner_id,
    chunk_index: overrides.chunk_index ?? 0,
    content: overrides.content ?? "content",
    embedding: overrides.embedding ?? E0,
    model: overrides.model ?? MODEL,
  };
}

const OWNER_A = "11111111-1111-4111-8111-111111111111";
const OWNER_B = "22222222-2222-4222-8222-222222222222";
const OWNER_C = "33333333-3333-4333-8333-333333333333";

//------------------------------------------------------------------------------
// tests
//------------------------------------------------------------------------------

describe("EmbeddingDbService.search_embeddings", () => {
  it("ranks by cosine similarity, closest first", async () => {
    const user_id = await make_user(pool, "ranker");
    await db.embedding_db.upsert_embedding(user_id, chunk(OWNER_A, { embedding: E0 }));
    await db.embedding_db.upsert_embedding(user_id, chunk(OWNER_B, { embedding: MID }));
    await db.embedding_db.upsert_embedding(user_id, chunk(OWNER_C, { embedding: E1 }));

    const hits = await db.embedding_db.search_embeddings({
      user_id, embedding: E0, model: MODEL,
    });

    assert.deepEqual(hits.map((h) => h.owner_id), [OWNER_A, OWNER_B, OWNER_C]);
    // Exact identity, the 45-degree midpoint, and orthogonal.
    // pgvector is not bit-exact so use a reasonable tolerance for equality.
    assert.ok(Math.abs(hits[0].similarity - 1) < 1e-6, `got ${hits[0].similarity}`);
    assert.ok(Math.abs(hits[1].similarity - Math.SQRT1_2) < 1e-6, `got ${hits[1].similarity}`);
    assert.ok(Math.abs(hits[2].similarity - 0) < 1e-6, `got ${hits[2].similarity}`);
  });

  it("never returns another user's vectors", async () => {
    const mine = await make_user(pool, "mine");
    const theirs = await make_user(pool, "theirs");
    await db.embedding_db.upsert_embedding(theirs, chunk(OWNER_A, { embedding: E0 }));

    const hits = await db.embedding_db.search_embeddings({
      user_id: mine, embedding: E0, model: MODEL,
    });

    assert.equal(hits.length, 0);
  });

  it("excludes vectors from a different model", async () => {
    const user_id = await make_user(pool, "modelfilter");
    await db.embedding_db.upsert_embedding(
      user_id, chunk(OWNER_A, { embedding: E0, model: "old-model" }));

    const hits = await db.embedding_db.search_embeddings({
      user_id, embedding: E0, model: MODEL,
    });

    assert.equal(hits.length, 0);
  });

  it("restricts to the requested owner kinds", async () => {
    const user_id = await make_user(pool, "kinds");
    await db.embedding_db.upsert_embedding(
      user_id, chunk(OWNER_A, { owner_kind: "note", embedding: E0 }));
    await db.embedding_db.upsert_embedding(
      user_id, chunk(OWNER_B, { owner_kind: "file", embedding: E0 }));

    const all = await db.embedding_db.search_embeddings({
      user_id, embedding: E0, model: MODEL,
    });
    const files = await db.embedding_db.search_embeddings({
      user_id, embedding: E0, model: MODEL, owner_kinds: ["file"],
    });

    assert.equal(all.length, 2);
    assert.deepEqual(files.map((h) => h.owner_id), [OWNER_B]);
  });

  it("drops hits below min_similarity", async () => {
    const user_id = await make_user(pool, "threshold");
    await db.embedding_db.upsert_embedding(user_id, chunk(OWNER_A, { embedding: E0 }));
    await db.embedding_db.upsert_embedding(user_id, chunk(OWNER_C, { embedding: E1 }));

    const hits = await db.embedding_db.search_embeddings({
      user_id, embedding: E0, model: MODEL, min_similarity: 0.5,
    });

    assert.deepEqual(hits.map((h) => h.owner_id), [OWNER_A]);
  });

  it("honours limit", async () => {
    const user_id = await make_user(pool, "limit");
    await db.embedding_db.upsert_embedding(user_id, chunk(OWNER_A, { embedding: E0 }));
    await db.embedding_db.upsert_embedding(user_id, chunk(OWNER_B, { embedding: MID }));

    const hits = await db.embedding_db.search_embeddings({
      user_id, embedding: E0, model: MODEL, limit: 1,
    });

    assert.deepEqual(hits.map((h) => h.owner_id), [OWNER_A]);
  });
});

describe("EmbeddingDbService.upsert_embedding", () => {
  it("overwrites a chunk in place rather than duplicating it", async () => {
    const user_id = await make_user(pool, "upsert");
    await db.embedding_db.upsert_embedding(
      user_id, chunk(OWNER_A, { content: "first", embedding: E0 }));
    await db.embedding_db.upsert_embedding(
      user_id, chunk(OWNER_A, { content: "second", embedding: E0 }));

    const hits = await db.embedding_db.search_embeddings({
      user_id, embedding: E0, model: MODEL,
    });

    assert.equal(hits.length, 1);
    assert.equal(hits[0].content, "second");
  });

  it("rejects a non-finite vector before it reaches the database", async () => {
    const user_id = await make_user(pool, "nonfinite");
    const bad = [...E0];
    bad[5] = Number.NaN;

    await assert.rejects(
      () => db.embedding_db.upsert_embedding(user_id, chunk(OWNER_A, { embedding: bad })),
      /element 5 is not finite/);
  });
});

describe("EmbeddingDbService.replace_owner_embeddings", () => {
  it("stores each chunk's own embedding, not one shared across the record", async () => {
    const user_id = await make_user(pool, "per-chunk");
    await db.embedding_db.replace_owner_embeddings(user_id, "note", OWNER_A, [
      chunk(OWNER_A, { chunk_index: 0, content: "c0", embedding: E0 }),
      chunk(OWNER_A, { chunk_index: 1, content: "c1", embedding: MID }),
      chunk(OWNER_A, { chunk_index: 2, content: "c2", embedding: E1 }),
    ]);

    const hits = await db.embedding_db.search_embeddings({
      user_id, embedding: E0, model: MODEL,
    });

    assert.deepEqual(hits.map((h) => h.content), ["c0", "c1", "c2"]);
    assert.deepEqual(hits.map((h) => h.chunk_index), [0, 1, 2]);
    assert.ok(
      hits[0].similarity > hits[1].similarity && hits[1].similarity > hits[2].similarity,
      `similarities should be strictly descending, got `
      + `${hits.map((h) => h.similarity.toFixed(4)).join(", ")}`);
  });

  it("removes chunks left over when the content shrinks", async () => {
    const user_id = await make_user(pool, "shrink");
    await db.embedding_db.replace_owner_embeddings(user_id, "note", OWNER_A, [
      chunk(OWNER_A, { chunk_index: 0, content: "c0", embedding: E0 }),
      chunk(OWNER_A, { chunk_index: 1, content: "c1", embedding: MID }),
      chunk(OWNER_A, { chunk_index: 2, content: "c2", embedding: E1 }),
    ]);

    // Re-embed the same record, now only one chunk long.
    await db.embedding_db.replace_owner_embeddings(user_id, "note", OWNER_A, [
      chunk(OWNER_A, { chunk_index: 0, content: "only", embedding: E0 }),
    ]);

    const hits = await db.embedding_db.search_embeddings({
      user_id, embedding: E0, model: MODEL,
    });

    assert.equal(hits.length, 1, "stale tail chunks should be gone");
    assert.equal(hits[0].content, "only");
  });

  it("clears every chunk when given an empty list", async () => {
    const user_id = await make_user(pool, "clear");
    await db.embedding_db.replace_owner_embeddings(user_id, "note", OWNER_A, [
      chunk(OWNER_A, { chunk_index: 0, embedding: E0 }),
      chunk(OWNER_A, { chunk_index: 1, embedding: E1 }),
    ]);

    await db.embedding_db.replace_owner_embeddings(user_id, "note", OWNER_A, []);

    const hits = await db.embedding_db.search_embeddings({
      user_id, embedding: E0, model: MODEL,
    });
    assert.equal(hits.length, 0);
  });

  it("rejects a gap in chunk_index", async () => {
    // Without this guard the insert of chunk 3 succeeds and the tail delete
    // (chunk_index >= 3) then removes it, in the same transaction, silently.
    const user_id = await make_user(pool, "gap");

    await assert.rejects(
      () => db.embedding_db.replace_owner_embeddings(user_id, "note", OWNER_A, [
        chunk(OWNER_A, { chunk_index: 0, embedding: E0 }),
        chunk(OWNER_A, { chunk_index: 1, embedding: MID }),
        chunk(OWNER_A, { chunk_index: 3, embedding: E1 }),
      ]),
      /chunk_index 3 is outside 0\.\.2/);
  });

  it("rejects a duplicate chunk_index", async () => {
    // Two chunks claiming one index means the second overwrites the first and
    // the record silently comes out shorter than it went in.
    const user_id = await make_user(pool, "dupe");

    await assert.rejects(
      () => db.embedding_db.replace_owner_embeddings(user_id, "note", OWNER_A, [
        chunk(OWNER_A, { chunk_index: 0, embedding: E0 }),
        chunk(OWNER_A, { chunk_index: 1, embedding: MID }),
        chunk(OWNER_A, { chunk_index: 1, embedding: E1 }),
      ]),
      /duplicate chunk_index 1/);
  });

  it("accepts indices covering the range out of order", async () => {
    // The contract is on the set of indices, not the array order.
    const user_id = await make_user(pool, "unordered");
    await db.embedding_db.replace_owner_embeddings(user_id, "note", OWNER_A, [
      chunk(OWNER_A, { chunk_index: 2, content: "c2", embedding: E1 }),
      chunk(OWNER_A, { chunk_index: 0, content: "c0", embedding: E0 }),
      chunk(OWNER_A, { chunk_index: 1, content: "c1", embedding: MID }),
    ]);

    const hits = await db.embedding_db.search_embeddings({
      user_id, embedding: E0, model: MODEL,
    });

    assert.deepEqual(hits.map((h) => h.chunk_index), [0, 1, 2]);
    assert.deepEqual(hits.map((h) => h.content), ["c0", "c1", "c2"]);
  });

  it("rejects a chunk belonging to a different owner", async () => {
    const user_id = await make_user(pool, "mismatch");

    await assert.rejects(
      () => db.embedding_db.replace_owner_embeddings(
        user_id, "note", OWNER_A, [chunk(OWNER_B, { embedding: E0 })]),
      /does not match/);
  });
});

describe("EmbeddingDbService cleanup", () => {
  it("delete_by_owner removes every chunk for that record only", async () => {
    const user_id = await make_user(pool, "delowner");
    await db.embedding_db.upsert_embedding(
      user_id, chunk(OWNER_A, { chunk_index: 0, embedding: E0 }));
    await db.embedding_db.upsert_embedding(
      user_id, chunk(OWNER_A, { chunk_index: 1, embedding: E0 }));
    await db.embedding_db.upsert_embedding(user_id, chunk(OWNER_B, { embedding: E0 }));

    const removed = await db.embedding_db.delete_by_owner("note", OWNER_A);

    assert.equal(removed, 2);
    const hits = await db.embedding_db.search_embeddings({
      user_id, embedding: E0, model: MODEL,
    });
    assert.deepEqual(hits.map((h) => h.owner_id), [OWNER_B]);
  });

  it("delete_superseded_models keeps only the current model", async () => {
    const user_id = await make_user(pool, "supersede");
    await db.embedding_db.upsert_embedding(
      user_id, chunk(OWNER_A, { embedding: E0, model: "old-model" }));
    await db.embedding_db.upsert_embedding(
      user_id, chunk(OWNER_B, { embedding: E0, model: MODEL }));

    const removed = await db.embedding_db.delete_superseded_models(user_id, MODEL);

    assert.equal(removed, 1);
    const counts = await db.embedding_db.count_by_kind(user_id);
    assert.deepEqual(counts, [{ owner_kind: "note", model: MODEL, count: 1 }]);
  });

  it("cascades when the owning user is deleted", async () => {
    const user_id = await make_user(pool, "cascade");
    await db.embedding_db.upsert_embedding(user_id, chunk(OWNER_A, { embedding: E0 }));

    await pool.query("DELETE FROM users WHERE id = $1", [user_id]);

    const remaining = await pool.query(
      "SELECT count(*)::int AS count FROM embeddings WHERE user_id = $1", [user_id]);
    assert.equal(remaining.rows[0].count, 0);
  });
});
