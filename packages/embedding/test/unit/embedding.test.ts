import { describe, it, afterEach } from "node:test";
import * as assert from "node:assert/strict";

import {
  EmbeddingInputType,
  MockEmbedder,
  TeiEmbedder,
  TeiEmbedderError,
} from "embedding";

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

function magnitude(v: number[]): number {
  return Math.sqrt(v.reduce((sum, w) => sum + w * w, 0));
}

describe("MockEmbedder", () => {
  it("returns one unit vector per input at the configured width", async () => {
    const e = new MockEmbedder({ dimensions: 64 });
    const out = await e.embed(["alpha", "beta"], EmbeddingInputType.Document);

    assert.equal(out.length, 2);
    for (const v of out) {
      assert.equal(v.length, 64);
      assert.ok(Math.abs(magnitude(v) - 1) < 1e-9, `not unit length: ${magnitude(v)}`);
    }
  });

  it("is deterministic across instances", async () => {
    const a = await new MockEmbedder({ dimensions: 64 })
      .embed(["same text"], EmbeddingInputType.Document);
    const b = await new MockEmbedder({ dimensions: 64 })
      .embed(["same text"], EmbeddingInputType.Document);

    assert.deepEqual(a[0], b[0]);
  });

  it("scores shared vocabulary above disjoint vocabulary", async () => {
    // The property that makes it usable for retrieval-plumbing tests: ranking
    // against it is meaningful, not arbitrary.
    const e = new MockEmbedder({ dimensions: 512 });
    const [query, overlapping, disjoint] = await e.embed(
      [
        "grant proposal specific aims",
        "the specific aims of the grant proposal",
        "cafeteria parking shuttle schedule",
      ],
      EmbeddingInputType.Document);

    assert.ok(
      cosine(query, overlapping) > cosine(query, disjoint),
      "overlapping text should score higher than disjoint text");
  });

  it("still returns a unit vector for input with no tokens", async () => {
    const e = new MockEmbedder({ dimensions: 32 });
    const out = await e.embed(["", "   ---   "], EmbeddingInputType.Document);

    for (const v of out) {
      assert.ok(Math.abs(magnitude(v) - 1) < 1e-9, "zero vector would break cosine");
    }
  });

  it("records the calls it saw", async () => {
    const e = new MockEmbedder({ dimensions: 32 });
    await e.embed(["q"], EmbeddingInputType.Query);

    assert.deepEqual(e.calls(), [
      { texts: ["q"], input_type: EmbeddingInputType.Query },
    ]);
  });
});

describe("TeiEmbedder", () => {
  const real_fetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = real_fetch; });

  interface Server {
    // Mutable so a test can make the server's answers change under a connected
    // embedder, which is the only way the drift guards are reachable.
    dims: number;
    bodies: any[];
    info_calls: number;
  }

  /*
   * Stand in for a TEI server on both routes connect() uses: /info replies with
   * a payload shaped like the real one, /embed replies with `dims`-wide vectors,
   * one per input. Every /embed body is recorded.
   */
  function stub_server(config: {
    dims?: number;
    model_id?: string;
    model_type?: unknown;
    max_client_batch_size?: number;
  } = {}): Server {
    const model_id = config.model_id ?? "BAAI/bge-m3";
    const server: Server = { dims: config.dims ?? 4, bodies: [], info_calls: 0 };
    const info = {
      model_id,
      model_dtype: "float32",
      served_model_name: model_id,
      model_type: config.model_type ?? { embedding: { pooling: "cls" } },
      max_concurrent_requests: 512,
      max_input_length: 8192,
      max_batch_tokens: 16384,
      max_client_batch_size: config.max_client_batch_size ?? 32,
      auto_truncate: false,
      tokenization_workers: 4,
      version: "1.8.3",
    };
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      if (String(url).endsWith("/info")) {
        server.info_calls++;
        return new Response(JSON.stringify(info), {
          status: 200, headers: { "content-type": "application/json" },
        });
      }
      const body = JSON.parse(String(init.body));
      server.bodies.push(body);
      const vectors = body.inputs.map(
        () => new Array(server.dims).fill(0).map((_, i) => (0 === i ? 1 : 0)));
      return new Response(JSON.stringify(vectors), {
        status: 200, headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    return server;
  }

  // connect() spends one /embed on its dimension probe; clearing the log keeps
  // each test asserting only on the requests it made itself.
  async function connect(server: Server, opts: Record<string, unknown> = {}) {
    const embedder = await TeiEmbedder.connect({ base_url: "http://embedder", ...opts });
    server.bodies.length = 0;
    return embedder;
  }

  //----------------------------------------------------------------------------
  // discovery
  //----------------------------------------------------------------------------

  it("adopts the model the server reports rather than being told one", async () => {
    const server = stub_server({ model_id: "BAAI/bge-large-en-v1.5" });

    assert.equal((await connect(server)).model(), "BAAI/bge-large-en-v1.5");
  });

  it("measures the vector width instead of taking it on faith", async () => {
    // /info carries no dimension field, and the model id does not fix one
    // either -- matryoshka models serve a width chosen at load time.
    const server = stub_server({ dims: 384 });

    assert.equal((await connect(server)).dimensions(), 384);
  });

  it("refuses a server whose width the caller cannot store", async () => {
    // The whole point of failing at connect: an embedder serving 768 into
    // vector(1024) storage produces perfectly good vectors that postgres
    // rejects one by one, inside whatever job happened to run first.
    const server = stub_server({ dims: 768 });

    await assert.rejects(
      () => connect(server, { expect_dimensions: 1024 }),
      (err: Error) =>
        err instanceof TeiEmbedderError
        && /serves 768-dim vectors, but this deployment requires 1024/.test(err.message));
  });

  it("accepts a server whose width matches what the caller requires", async () => {
    const server = stub_server({ dims: 1024 });

    assert.equal((await connect(server, { expect_dimensions: 1024 })).dimensions(), 1024);
  });

  it("rejects a non-positive expect_dimensions before touching the network", async () => {
    const server = stub_server();

    await assert.rejects(
      () => TeiEmbedder.connect({ base_url: "http://embedder", expect_dimensions: 0 }),
      TeiEmbedderError);
    assert.equal(server.info_calls, 0);
  });

  it("exposes the server's limits for callers that must chunk to them", async () => {
    const server = stub_server();

    const info = (await connect(server)).server_info();

    assert.equal(info.max_input_length, 8192);
    assert.equal(info.max_client_batch_size, 32);
    assert.equal(info.version, "1.8.3");
  });

  it("refuses a model whose prefix convention it does not know", async () => {
    // Guessing here is worse than failing: an unprefixed query still returns a
    // well-formed vector, it is just a worse one, so nothing ever surfaces.
    const server = stub_server({ model_id: "acme/mystery-embed" });

    await assert.rejects(
      () => connect(server),
      (err: Error) =>
        err instanceof TeiEmbedderError && /does not know/.test(err.message));
  });

  it("accepts an unknown model when both prefixes are stated explicitly", async () => {
    const server = stub_server({ model_id: "acme/mystery-embed" });
    const e = await connect(server, { query_prefix: "q> ", document_prefix: "d> " });

    await e.embed(["find this"], EmbeddingInputType.Query);

    assert.equal(server.bodies[0].inputs[0], "q> find this");
  });

  it("refuses a server that is running a reranker rather than an embedding model", async () => {
    // A reranker answers /info happily and only fails at /embed, well after the
    // point where the message would still be obvious.
    const server = stub_server({ model_type: { reranker: { id2label: {} } } });

    await assert.rejects(
      () => connect(server),
      (err: Error) =>
        err instanceof TeiEmbedderError && /not an embedding model/.test(err.message));
  });

  it("waits out a server that is still loading its model", async () => {
    const server = stub_server();
    const warm_fetch = globalThis.fetch;
    let refusals = 2;
    globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
      if (refusals > 0 && String(url).endsWith("/info")) {
        refusals--;
        throw new TypeError("fetch failed");
      }
      return warm_fetch(url as any, init);
    }) as unknown as typeof fetch;

    const e = await TeiEmbedder.connect({
      base_url: "http://embedder", ready_timeout_ms: 5_000, ready_poll_ms: 1,
    });

    assert.equal(refusals, 0);
    assert.equal(e.model(), "BAAI/bge-m3");
  });

  it("gives up on an unreachable server once the ready window closes", async () => {
    globalThis.fetch = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;

    await assert.rejects(
      () => TeiEmbedder.connect({ base_url: "http://embedder", ready_timeout_ms: 0 }),
      (err: Error) =>
        err instanceof TeiEmbedderError && /request to \/info failed/.test(err.message));
  });

  it("does not wait out a malformed /info, which no amount of warming fixes", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ model_id: "" }), {
        status: 200, headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    await assert.rejects(
      () => TeiEmbedder.connect({ base_url: "http://embedder", ready_timeout_ms: 30_000 }),
      (err: Error) =>
        err instanceof TeiEmbedderError && /returned no model_id/.test(err.message));
  });

  //----------------------------------------------------------------------------
  // request shaping
  //----------------------------------------------------------------------------

  it("prefixes queries but not documents for bge-*-en-v1.5", async () => {
    const server = stub_server({ model_id: "BAAI/bge-large-en-v1.5" });
    const e = await connect(server);

    await e.embed(["find this"], EmbeddingInputType.Query);
    await e.embed(["store this"], EmbeddingInputType.Document);

    assert.equal(
      server.bodies[0].inputs[0],
      "Represent this sentence for searching relevant passages: find this");
    assert.equal(server.bodies[1].inputs[0], "store this");
  });

  it("applies no prefix for bge-m3, which is trained without one", async () => {
    const server = stub_server();
    const e = await connect(server);

    await e.embed(["find this"], EmbeddingInputType.Query);

    assert.equal(server.bodies[0].inputs[0], "find this");
  });

  it("lets an explicit empty prefix override the known one", async () => {
    const server = stub_server({ model_id: "BAAI/bge-large-en-v1.5" });
    const e = await connect(server, { query_prefix: "" });

    await e.embed(["find this"], EmbeddingInputType.Query);

    assert.equal(server.bodies[0].inputs[0], "find this");
  });

  it("asks the server to normalize, so vectors match the port's contract", async () => {
    const server = stub_server();
    const e = await connect(server);

    await e.embed(["x"], EmbeddingInputType.Document);

    assert.equal(server.bodies[0].normalize, true);
  });

  it("splits batches to the limit the server reports", async () => {
    const server = stub_server({ max_client_batch_size: 2 });
    const e = await connect(server);

    const out = await e.embed(["a", "b", "c", "d", "e"], EmbeddingInputType.Document);

    assert.equal(out.length, 5);
    assert.deepEqual(server.bodies.map((b) => b.inputs.length), [2, 2, 1]);
  });

  it("never exceeds the server's limit even when asked for a larger batch", async () => {
    // The server rejects an oversized batch outright, so its cap has to win.
    const server = stub_server({ max_client_batch_size: 2 });
    const e = await connect(server, { batch_size: 10 });

    await e.embed(["a", "b", "c"], EmbeddingInputType.Document);

    assert.deepEqual(server.bodies.map((b) => b.inputs.length), [2, 1]);
  });

  it("honours a batch_size below the server's limit", async () => {
    const server = stub_server({ max_client_batch_size: 32 });
    const e = await connect(server, { batch_size: 2 });

    await e.embed(["a", "b", "c"], EmbeddingInputType.Document);

    assert.deepEqual(server.bodies.map((b) => b.inputs.length), [2, 1]);
  });

  it("makes no request at all for an empty input list", async () => {
    const server = stub_server();
    const e = await connect(server);

    assert.deepEqual(await e.embed([], EmbeddingInputType.Document), []);
    assert.equal(server.bodies.length, 0);
  });

  //----------------------------------------------------------------------------
  // failure modes
  //----------------------------------------------------------------------------

  it("rejects vectors that no longer match the width measured at connect", async () => {
    // Reachable only if the server swaps models under a live embedder. Vectors
    // of a new width are meaningless against everything already stored.
    const server = stub_server({ dims: 1024 });
    const e = await connect(server);
    server.dims = 768;

    await assert.rejects(
      () => e.embed(["x"], EmbeddingInputType.Document),
      (err: Error) =>
        err instanceof TeiEmbedderError && /768-dim vector at index 0/.test(err.message));
  });

  it("surfaces a non-2xx response as TeiEmbedderError with the server's detail", async () => {
    const server = stub_server();
    const e = await connect(server);
    globalThis.fetch = (async () =>
      new Response("model is overloaded", { status: 503 })) as unknown as typeof fetch;

    await assert.rejects(
      () => e.embed(["x"], EmbeddingInputType.Document),
      (err: Error) =>
        err instanceof TeiEmbedderError && /503: model is overloaded/.test(err.message));
  });

  it("rejects a non-positive batch_size before touching the network", async () => {
    const server = stub_server();

    await assert.rejects(
      () => TeiEmbedder.connect({ base_url: "http://embedder", batch_size: 0 }),
      TeiEmbedderError);
    assert.equal(server.info_calls, 0);
  });
});
