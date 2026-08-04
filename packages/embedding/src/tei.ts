export {
  TeiEmbedder,
  TeiEmbedderError,
}
export type {
  TeiEmbedderOpts,
  TeiServerInfo,
}

import { Embedder, Embedding, EmbeddingInputType } from "./port.js";

/*
 * TeiEmbedder speaks to a self-hosted HuggingFace Text Embeddings Inference
 * (TEI) server over its /embed endpoint.
 *
 * TEI serves exactly one model per container, fixed by --model-id at startup.
 * This adapter discovers and configures itself by reading the /info endpoint of
 * the TEI server. It refuses any model whose prefix convention it does not
 * know, adopts the server's batch limit, and measures the vector width with one
 * probe embed.
 */

interface TeiEmbedderOpts {
  base_url: string;
  // Omit only when the caller genuinely accepts any width.
  expect_dimensions?: number;
  timeout_ms?: number;
  // Upper bound on inputs per request. The server's max_client_batch_size is
  // read from /info and used instead.
  batch_size?: number;
  // Instruction prefixes applied per input type. Omit for a model in the known
  // table. A model outside that table must supply BOTH -- pass empty strings to
  // state that it expects none.
  query_prefix?: string;
  document_prefix?: string;
  // How long connect() keeps retrying /info while the server loads its model.
  // TEI does not answer until its backend is warm and cold start on CPU is tens
  // of seconds.
  ready_timeout_ms?: number;
  ready_poll_ms?: number;
}

// The subset of TEI's /info this adapter reads. max_input_length is the budget
// a caller must use to chunk.
interface TeiServerInfo {
  model_id: string;
  max_input_length: number;
  max_batch_tokens: number;
  max_client_batch_size: number;
  auto_truncate: boolean;
  version: string;
}

// A generic error for TEI embedding errors. `retryable` marks the failure as
// one that should be re-submitted.
class TeiEmbedderError extends Error {
  public readonly cause?: unknown;
  public readonly retryable: boolean;
  constructor(message: string, cause?: unknown, retryable: boolean = false) {
    super(message);
    this.name = "TeiEmbedderError";
    this.cause = cause;
    this.retryable = retryable;
  }
}

class TeiEmbedder implements Embedder {
  private readonly _base_url: string;
  private readonly _timeout_ms: number;
  private readonly _batch_size: number;
  private readonly _query_prefix: string;
  private readonly _document_prefix: string;
  private readonly _dimensions: number;
  private readonly _info: Readonly<TeiServerInfo>;

  // Private on purpose: every field below is discovered from the server, so
  // there is nothing a caller could correctly pass. Use connect().
  private constructor(fields: {
    base_url: string;
    timeout_ms: number;
    batch_size: number;
    query_prefix: string;
    document_prefix: string;
    dimensions: number;
    info: Readonly<TeiServerInfo>;
  }) {
    this._base_url = fields.base_url;
    this._timeout_ms = fields.timeout_ms;
    this._batch_size = fields.batch_size;
    this._query_prefix = fields.query_prefix;
    this._document_prefix = fields.document_prefix;
    this._dimensions = fields.dimensions;
    this._info = fields.info;
  }

  /*
   * (TeiEmbedderOpts) => TeiEmbedder
   * Reconcile with the running server and return an embedder bound to it.
   * Reads /info for the model id and the server's limits, rejects a model whose
   * prefix convention is unknown, then measures the vector width with one probe
   * embed and holds it to expect_dimensions if the caller gave one.
   * Side Effect: network calls to the TEI server. Throws if the server is
   *   unreachable past ready_timeout_ms, is not serving an embedding model, is
   *   serving a model this adapter does not recognize, or serves a width other
   *   than expect_dimensions
   * Public, static
   */
  public static async connect(opts: TeiEmbedderOpts): Promise<TeiEmbedder> {
    if (undefined !== opts.batch_size
        && (!Number.isInteger(opts.batch_size) || opts.batch_size < 1)) {
      throw new TeiEmbedderError(
        `TeiEmbedder config: batch_size must be a positive integer, got ${opts.batch_size}`);
    }
    if (undefined !== opts.expect_dimensions
        && (!Number.isInteger(opts.expect_dimensions) || opts.expect_dimensions < 1)) {
      throw new TeiEmbedderError(
        `TeiEmbedder config: expect_dimensions must be a positive integer, `
        + `got ${opts.expect_dimensions}`);
    }
    // Trailing slash would produce a double slash on join; normalize once here.
    const base_url = opts.base_url.replace(/\/+$/, "");
    const timeout_ms = opts.timeout_ms ?? _DEFAULT_TIMEOUT_MS;

    const info = await _await_info(
      base_url,
      timeout_ms,
      opts.ready_timeout_ms ?? _DEFAULT_READY_TIMEOUT_MS,
      opts.ready_poll_ms ?? _DEFAULT_READY_POLL_MS);

    const known = _MODEL_PREFIXES[info.model_id];
    if (undefined === known
        && (undefined === opts.query_prefix || undefined === opts.document_prefix)) {
      // An unknown model still returns well-formed vectors without its
      // prefixes but in the wrong space. Better to throw an error.
      throw new TeiEmbedderError(
        `TEI server is running "${info.model_id}", whose instruction prefixes this `
        + `adapter does not know. Serve one of [${Object.keys(_MODEL_PREFIXES).join(", ")}], `
        + `or pass query_prefix and document_prefix explicitly (empty strings if the `
        + `model expects none).`);
    }
    // Unread when `known` is undefined: that branch above guarantees both
    // prefixes were supplied.
    const prefixes = known ?? _NO_PREFIXES;
    const dimensions = await _probe_dimensions(base_url, timeout_ms);
    if (undefined !== opts.expect_dimensions 
        && dimensions !== opts.expect_dimensions) {
      throw new TeiEmbedderError(
        `TEI server is running "${info.model_id}", which serves ${dimensions}-dim `
        + `vectors, but this deployment requires ${opts.expect_dimensions}. Serve a `
        + `model of the required width, or migrate the storage that fixed it.`);
    }

    return new TeiEmbedder({
      base_url,
      timeout_ms,
      // The server rejects anything over its own limit.
      batch_size: Math.min(
        opts.batch_size ?? info.max_client_batch_size, info.max_client_batch_size),
      query_prefix: opts.query_prefix ?? prefixes.query,
      document_prefix: opts.document_prefix ?? prefixes.document,
      dimensions,
      info,
    });
  }

  /*
   * (void) => number
   * The measured width of this server's vectors.
   * Pure
   * Public
   */
  public dimensions(): number {
    return this._dimensions;
  }

  /*
   * (void) => string
   * The model the server reported at connect time.
   * Pure
   * Public
   */
  public model(): string {
    return this._info.model_id;
  }

  /*
   * (void) => TeiServerInfo
   * The server's self-reported limits, as read at connect time. max_input_length
   * is what a chunker must size against.
   * Pure
   * Public
   */
  public server_info(): Readonly<TeiServerInfo> {
    return this._info;
  }

  /*
   * (string[], EmbeddingInputType) => Embedding[]
   * Embed a batch, chunked to the server's client-batch limit. Returns one
   * vector per input, in input order. An empty input list is a no-op.
   * Side Effect: network calls to the TEI server
   * Public
   */
  public async embed(
      texts: string[], input_type: EmbeddingInputType): Promise<Embedding[]> {
    if (0 === texts.length) return [];
    const prefix = EmbeddingInputType.Query === input_type
      ? this._query_prefix
      : this._document_prefix;
    const prepared = texts.map((text) => `${prefix}${text}`);
    const embeddings: Embedding[] = [];
    for (let i = 0; i < prepared.length; i += this._batch_size) {
      const chunk = prepared.slice(i, i + this._batch_size);
      embeddings.push(...await this._embed_chunk(chunk));
    }
    return embeddings;
  }

  /*
   * (string[]) => Embedding[]
   * One /embed round trip, with the returned widths checked against the width
   * measured at connect time.
   * Side Effect: network call to the TEI server
   * Private
   */
  private async _embed_chunk(chunk: string[]): Promise<Embedding[]> {
    const vectors = await _post_embed(this._base_url, this._timeout_ms, chunk);
    vectors.forEach((vector, i) => {
      if (vector.length !== this._dimensions) {
        // Only reachable if the server swapped models underneath a live
        // embedder.
        throw new TeiEmbedderError(
          `TEI /embed returned a ${vector.length}-dim vector at index ${i}, but this `
          + `embedder measured ${this._dimensions} at connect time; the server's model `
          + `changed underneath it`);
      }
    });
    return vectors;
  }
}

/*
 * (string, number, number, number) => TeiServerInfo
 * Read /info, waiting out the transport failures a server still loading its
 * model produces. A malformed or contradictory payload is a real defect and
 * fails immediately.
 * Side Effect: network calls, sleeps between attempts
 * Private
 */
async function _await_info(
    base_url: string,
    timeout_ms: number,
    ready_timeout_ms: number,
    poll_ms: number): Promise<TeiServerInfo> {
  const deadline = Date.now() + ready_timeout_ms;
  for (;;) {
    try {
      return _parse_info(await _get_json(base_url, timeout_ms, "/info"));
    } catch (err) {
      const retryable = err instanceof TeiEmbedderError && err.retryable;
      const remaining = deadline - Date.now();
      if (!retryable || remaining <= 0) throw err;
      await _sleep(Math.min(poll_ms, remaining));
    }
  }
}

/*
 * (unknown) => TeiServerInfo
 * Validate the /info payload and narrow it to the fields this adapter uses.
 * Pure
 * Private
 */
function _parse_info(body: unknown): TeiServerInfo {
  if (null === body || "object" !== typeof body) {
    throw new TeiEmbedderError("TEI /info did not return an object");
  }
  const info = body as Record<string, unknown>;
  const model_id = info["model_id"];
  if ("string" !== typeof model_id || "" === model_id) {
    throw new TeiEmbedderError("TEI /info returned no model_id");
  }

  // model_type is a tagged union: { embedding: {...} } | { reranker: {...} } |
  // { classifier: {...} }. A reranker answers /info happily and only falls over
  // at /embed, with a much less obvious message than this one.
  const model_type = info["model_type"];
  const is_object = null !== model_type && "object" === typeof model_type;
  if (!is_object || !("embedding" in (model_type as object))) {
    const kind = is_object
      ? Object.keys(model_type as object).join("/")
      : String(model_type);
    throw new TeiEmbedderError(
      `TEI server is running "${model_id}" as a ${kind} model, not an embedding model`);
  }

  return Object.freeze({
    model_id,
    max_input_length: _positive_int(info["max_input_length"], "max_input_length"),
    max_batch_tokens: _positive_int(info["max_batch_tokens"], "max_batch_tokens"),
    max_client_batch_size:
      _positive_int(info["max_client_batch_size"], "max_client_batch_size"),
    auto_truncate: true === info["auto_truncate"],
    version: "string" === typeof info["version"] ? info["version"] : "unknown",
  });
}

/*
 * (unknown, string) => number
 * Pure
 * Private
 */
function _positive_int(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new TeiEmbedderError(
      `TEI /info returned an unusable ${field}: ${String(value)}`);
  }
  return value as number;
}

/*
 * (string, number) => number
 * Measure the server's vector width by embedding one throwaway input. /info
 * does not report the dimension, and a model id does not determine it either.
 * Side Effect: network call to the TEI server
 * Private
 */
async function _probe_dimensions(base_url: string, timeout_ms: number): Promise<number> {
  const [vector] = await _post_embed(base_url, timeout_ms, [_PROBE_TEXT]);
  if (undefined === vector || 0 === vector.length) {
    throw new TeiEmbedderError("TEI /embed returned no vector for the dimension probe");
  }
  return vector.length;
}

/*
 * (string, number, string[]) => Embedding[]
 * One /embed round trip. Validates that the response is an array of numeric
 * vectors, one per input. Width is the caller's business.
 * Side Effect: network call to the TEI server
 * Private
 */
async function _post_embed(
    base_url: string, timeout_ms: number, inputs: string[]): Promise<Embedding[]> {
  const body = await _post_json(base_url, timeout_ms, "/embed", {
    inputs,
    // TEI normalizes to unit length; the port promises unit vectors and the
    // pgvector index assumes them.
    normalize: true,
    // Over-long inputs are clipped to the model's context rather than 413ing
    // the whole batch. Chunking upstream is what actually preserves meaning.
    truncate: true,
  });
  if (!Array.isArray(body)) {
    throw new TeiEmbedderError("TEI /embed did not return an array");
  }
  if (body.length !== inputs.length) {
    throw new TeiEmbedderError(
      `TEI /embed returned ${body.length} vectors for ${inputs.length} inputs`);
  }
  return body.map((embedding, i) => {
    if (!Array.isArray(embedding) || embedding.some((n) => "number" !== typeof n)) {
      throw new TeiEmbedderError(`TEI /embed vector ${i} is not a number array`);
    }
    return embedding as Embedding;
  });
}

/*
 * (string, number, string, unknown) => unknown
 * Side Effect: network call
 * Private
 */
async function _post_json(
    base_url: string, timeout_ms: number, path: string, payload: unknown): Promise<unknown> {
  return _request(base_url, timeout_ms, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/*
 * (string, number, string) => unknown
 * Side Effect: network call
 * Private
 */
async function _get_json(
    base_url: string, timeout_ms: number, path: string): Promise<unknown> {
  return _request(base_url, timeout_ms, path, { method: "GET" });
}

/*
 * (string, number, string, RequestInit) => unknown
 * Issue the request and parse the JSON response, mapping every failure mode
 * onto TeiEmbedderError. Transport failures and 5xx are marked retryable
 * because they are what a server that has not finished loading produces.
 * Side Effect: network call
 * Private
 */
async function _request(
    base_url: string, timeout_ms: number, path: string, init: RequestInit): Promise<unknown> {
  const url = `${base_url}${path}`;
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeout_ms),
    });
  } catch (err) {
    throw new TeiEmbedderError(`TEI request to ${path} failed`, err, true);
  }
  if (!response.ok) {
    // Body is the server's error detail; losing it makes these undebuggable.
    const detail = await response.text().catch(() => "<unreadable body>");
    throw new TeiEmbedderError(
      `TEI ${path} returned ${response.status}: ${detail.slice(0, 500)}`,
      undefined,
      response.status >= 500);
  }
  try {
    return await response.json();
  } catch (err) {
    throw new TeiEmbedderError(`TEI ${path} returned malformed JSON`, err);
  }
}

/*
 * (number) => void
 * Side Effect: waits
 * Private
 */
function _sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Declared above _MODEL_PREFIXES because that table reads it at module load.
const _BGE_EN_QUERY = "Represent this sentence for searching relevant passages: ";

/*
 * Instruction prefixes each known model expects, by model id. This table is
 * also the gate on which models connect() will accept at all.
 *
 * Retrieval models encode this asymmetry differently and getting it wrong is a
 * silent quality loss, not an error: the vectors still come back, they just sit
 * in the wrong part of the space. The bge-*-en-v1.5 family prefixes queries only
 * and leaves passages bare; the e5 and nomic families prefix both sides; bge-m3
 * is trained without prefixes and scores worse with them.
 *
 * Serving a model that is not listed here is a deliberate act: check its model
 * card and pass query_prefix/document_prefix explicitly, or add it here.
 */
const _MODEL_PREFIXES: Readonly<Record<string, { query: string; document: string }>> =
  Object.freeze({
    "BAAI/bge-large-en-v1.5":  { query: _BGE_EN_QUERY, document: "" },
    "BAAI/bge-base-en-v1.5":   { query: _BGE_EN_QUERY, document: "" },
    "BAAI/bge-small-en-v1.5":  { query: _BGE_EN_QUERY, document: "" },
    "BAAI/bge-m3":             { query: "",            document: "" },
    "intfloat/e5-large-v2":    { query: "query: ",     document: "passage: " },
    "intfloat/e5-base-v2":     { query: "query: ",     document: "passage: " },
    "intfloat/multilingual-e5-large": { query: "query: ", document: "passage: " },
    "nomic-ai/nomic-embed-text-v1.5":
      { query: "search_query: ", document: "search_document: " },
  });

const _NO_PREFIXES = Object.freeze({ query: "", document: "" });

// Generous: CPU inference on a full batch is not fast.
const _DEFAULT_TIMEOUT_MS = 60_000;
// Long enough to cover a cold start, short enough that a genuinely misconfigured
// base_url still fails within a deploy's patience. A first boot downloading
// weights can exceed this; retry the deploy or raise it.
const _DEFAULT_READY_TIMEOUT_MS = 120_000;
const _DEFAULT_READY_POLL_MS = 2_000;
// Content is irrelevant -- only the width of what comes back is read.
const _PROBE_TEXT = "dimension probe";
