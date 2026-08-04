// embedding.test.ts (integration)
//
// Exercises TeiEmbedder against the real embedding server on the compose
// network. The unit suite covers discovery and request shaping with a stubbed
// fetch; these tests cover what only a live server can answer:
//
//   * connect() parses the real /info payload, so discovery can be trusted
//   * what the server serves agrees with how the stack was configured
//   * the wire contract actually holds (shape, width, ordering)
//   * TEI honours normalize/truncate, which the port's callers depend on
//   * the served model behaves like a retrieval model at all
//   * MockEmbedder is still a faithful stand-in for it
//
// Skipped with a reason when the stack is not up -- see harness.ts.

import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import {
  EmbeddingInputType,
  MockEmbedder,
  TeiEmbedder,
  TeiEmbedderError,
} from "embedding";
import type { Embedder, Embedding } from "embedding";
// The width migration 012 fixed `embeddings.embedding` at. Imported rather than
// copied so a schema change cannot leave a stale literal here that keeps passing
// against the wrong value -- this suite is the only place the served model and
// the storage that must hold it are checked against each other.
import { EMBEDDING_DIMENSIONS } from "db";
// Explicit .ts extension: these files are executed directly by Node's type
// stripping, which resolves specifiers literally rather than applying
// TypeScript's .js -> .ts rewrite. The "embedding" and "db" imports above
// resolve through the workspace links into build/, so only this one is affected.
import { embedder_config, skip_reason } from "./harness.ts";

//------------------------------------------------------------------------------
// helpers
//------------------------------------------------------------------------------

// The stack is already up by the time these run -- harness.ts gated on /health
// -- so there is nothing left to wait out and a hang would just hide a failure.
function make_embedder(overrides: Record<string, unknown> = {}): Promise<TeiEmbedder> {
  return TeiEmbedder.connect({
    base_url: embedder_config.base_url,
    ready_timeout_ms: 0,
    ...overrides,
  });
}

// Vectors are unit length, so the dot product is the cosine similarity.
function cosine(a: Embedding, b: Embedding): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function magnitude(v: Embedding): number {
  return Math.sqrt(v.reduce((sum, w) => sum + w * w, 0));
}

// Models that prepend an instruction to queries but not to documents. For these
// the same text must embed differently on each side; a model without prefixes
// (bge-m3) legitimately produces identical vectors, so that assertion is only
// meaningful here.
const PREFIXES_QUERIES =
  /bge-(large|base|small)-en-v1\.5$/.test(embedder_config.model) ||
  /e5-|nomic-embed/.test(embedder_config.model);

//------------------------------------------------------------------------------
// discovery, against the real /info payload
//------------------------------------------------------------------------------

describe("TeiEmbedder.connect", { skip: skip_reason }, () => {
  it("discovers the model the server is actually serving", async () => {
    // Also checks the compose wiring: EMBEDDER_MODEL is what reaches --model-id.
    // A drift here means the container silently loaded something else.
    const embedder = await make_embedder();

    assert.equal(embedder.model(), embedder_config.model);
  });

  it("serves a width the embeddings schema can store", async () => {
    // How the app builds it: the caller states the width its storage is fixed
    // at and connect() holds the server to it. A deployment whose server
    // disagrees fails here instead of at the first write. Nothing but a live
    // server can settle whether this one agrees.
    const embedder = await make_embedder({ expect_dimensions: EMBEDDING_DIMENSIONS });

    assert.equal(embedder.dimensions(), EMBEDDING_DIMENSIONS);
  });

  it("refuses a width this deployment could not store", async () => {
    await assert.rejects(
      () => make_embedder({ expect_dimensions: EMBEDDING_DIMENSIONS + 1 }),
      (err: Error) =>
        err instanceof TeiEmbedderError
        && new RegExp(`requires ${EMBEDDING_DIMENSIONS + 1}`).test(err.message));
  });

  it("reads the server's real limits", async () => {
    const info = (await make_embedder()).server_info();

    assert.ok(info.max_input_length > 0, "max_input_length must be usable for chunking");
    assert.ok(info.max_client_batch_size > 0, "max_client_batch_size bounds every request");
    assert.ok(info.version.length > 0, "version should come through for boot logging");
  });
});

//------------------------------------------------------------------------------
// wire contract
//------------------------------------------------------------------------------

describe("TeiEmbedder against the live server", { skip: skip_reason }, () => {
  it("returns one vector per input at the measured width", async () => {
    const embedder = await make_embedder();
    const out = await embedder.embed(
      ["first document", "second document", "third document"],
      EmbeddingInputType.Document);

    assert.equal(out.length, 3);
    for (const v of out) {
      assert.equal(v.length, embedder.dimensions());
      assert.ok(v.every((n) => Number.isFinite(n)), "vector contains a non-finite value");
    }
  });

  it("returns unit-normalized vectors", async () => {
    // The port promises unit vectors and the pgvector HNSW index is built with
    // vector_cosine_ops on that assumption. This is the only place that promise
    // is checked against the server rather than against a stub.
    const embedder = await make_embedder();
    const [v] = await embedder.embed(["normalization check"], EmbeddingInputType.Document);

    assert.ok(
      Math.abs(magnitude(v) - 1) < 1e-5,
      `expected unit length, got ${magnitude(v)}`);
  });

  it("is deterministic for identical input", async () => {
    const embedder = await make_embedder();
    const [a] = await embedder.embed(["stable text"], EmbeddingInputType.Document);
    const [b] = await embedder.embed(["stable text"], EmbeddingInputType.Document);

    assert.ok(
      cosine(a, b) > 1 - 1e-6,
      `same text should embed identically, cosine was ${cosine(a, b)}`);
  });

  it("preserves input order when the batch is split across requests", async () => {
    // batch_size 2 over 5 inputs forces three round trips. Each input must still
    // line up with its own vector -- an off-by-one here would silently attach
    // every stored vector to the wrong chunk.
    const batched = await (await make_embedder({ batch_size: 2 })).embed(
      ["alpha", "bravo", "charlie", "delta", "echo"], EmbeddingInputType.Document);
    const singles = await (await make_embedder()).embed(
      ["charlie"], EmbeddingInputType.Document);

    assert.equal(batched.length, 5);
    assert.ok(
      cosine(batched[2], singles[0]) > 1 - 1e-6,
      "the third batched vector should match 'charlie' embedded alone");
  });

  it("truncates input longer than the model's context instead of failing", async () => {
    // The server reports auto_truncate=false, so the per-request truncate flag
    // the adapter sends is the only thing keeping an over-long document from
    // being rejected outright. Documents this size are routine.
    const long_text = "precision medicine genomics research ".repeat(1_000);
    const embedder = await make_embedder();

    const [v] = await embedder.embed([long_text], EmbeddingInputType.Document);

    assert.equal(v.length, embedder.dimensions());
  });

  it("makes no request for an empty input list", async () => {
    const embedder = await make_embedder();
    assert.deepEqual(await embedder.embed([], EmbeddingInputType.Document), []);
  });
});

//------------------------------------------------------------------------------
// retrieval behaviour
//------------------------------------------------------------------------------

describe("served model retrieval behaviour", { skip: skip_reason }, () => {
  it("scores a related document above an unrelated one", async () => {
    // The end-to-end claim the whole module rests on: that these vectors carry
    // meaning. Nothing in the unit suite can establish it.
    const embedder = await make_embedder();
    const [query] = await embedder.embed(
      ["How do I submit a grant proposal?"], EmbeddingInputType.Query);
    const [related, unrelated] = await embedder.embed(
      [
        "Instructions for submitting your grant application to the funding agency.",
        "The cafeteria serves lunch between 11am and 2pm on weekdays.",
      ],
      EmbeddingInputType.Document);

    const related_score = cosine(query, related);
    const unrelated_score = cosine(query, unrelated);
    assert.ok(
      related_score > unrelated_score,
      `related (${related_score.toFixed(4)}) should outscore `
      + `unrelated (${unrelated_score.toFixed(4)})`);
  });

  it("embeds the same text differently as a query and as a document", {
    skip: PREFIXES_QUERIES
      ? false
      : `${embedder_config.model} does not prefix queries, so both sides are identical by design`,
  }, async () => {
    const embedder = await make_embedder();
    const [as_query] = await embedder.embed(["grant proposal"], EmbeddingInputType.Query);
    const [as_document] = await embedder.embed(["grant proposal"], EmbeddingInputType.Document);

    // Same text, so they stay close -- the point is only that the instruction
    // prefix reached the model and moved the vector.
    assert.ok(
      cosine(as_query, as_document) < 1 - 1e-6,
      "query and document embeddings should differ when the model prefixes queries");
  });
});

//------------------------------------------------------------------------------
// failure modes
//------------------------------------------------------------------------------

describe("TeiEmbedder failure modes against the live server", { skip: skip_reason }, () => {
  it("surfaces a non-2xx response as TeiEmbedderError", async () => {
    const wrong_path = { base_url: `${embedder_config.base_url}/not-a-route` };

    await assert.rejects(
      () => make_embedder(wrong_path),
      (err: Error) => err instanceof TeiEmbedderError && /returned 4\d\d/.test(err.message));
  });

  it("surfaces an unreachable server as TeiEmbedderError rather than hanging", async () => {
    // Port 1 is reserved and nothing listens on it, so the connection is
    // refused immediately.
    await assert.rejects(
      () => make_embedder({ base_url: "http://127.0.0.1:1", timeout_ms: 5_000 }),
      TeiEmbedderError);
  });
});

//------------------------------------------------------------------------------
// double fidelity
//------------------------------------------------------------------------------

describe("MockEmbedder stays a faithful stand-in", { skip: skip_reason }, () => {
  it("satisfies the same port contract as the live embedder", async () => {
    // MockEmbedder is what the webserver runs under APP_ENV=test. If it drifts
    // from the real adapter -- different width, un-normalized vectors, dropped
    // inputs -- tests keep passing while production breaks. Checking both
    // against one set of assertions is what keeps the substitution honest.
    const inputs = ["alpha text", "bravo text", "charlie text"];
    const live: Embedder = await make_embedder();
    // Width comes from the live server rather than a constant, so the mock is
    // held to whatever is actually deployed.
    const mock: Embedder = new MockEmbedder({ dimensions: live.dimensions() });

    for (const embedder of [live, mock]) {
      const label = embedder === mock ? "MockEmbedder" : "TeiEmbedder";
      const out = await embedder.embed(inputs, EmbeddingInputType.Document);

      assert.equal(out.length, inputs.length, `${label} returned the wrong count`);
      assert.equal(embedder.dimensions(), live.dimensions(), `${label} width`);
      assert.ok(embedder.model().length > 0, `${label} must report a model id`);
      for (const v of out) {
        assert.equal(v.length, embedder.dimensions(), `${label} vector width`);
        assert.ok(
          Math.abs(magnitude(v) - 1) < 1e-5,
          `${label} returned a vector of length ${magnitude(v)}, expected unit`);
      }
    }
  });
});
