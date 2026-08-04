export {
  MockEmbedder,
}
export type {
  MockEmbedderOpts,
  MockEmbedCall,
}

import { Embedder, Embedding, EmbeddingInputType } from "./port.js";

/*
 * MockEmbedder is a deterministic offline Embedder double. The host selects it
 * in test mode. Unit tests construct it directly.
 *
 * It is a hashed bag-of-words embedder. Tokens hash into fixed buckets meaning
 * that texts that share vocabulary land near each other. Ranking, thresholds,
 * and top-kb can asserted against it but it carries no semantics beyond word
 * overlap. This proves wiring but not retrieval quality.
 */

interface MockEmbedderOpts {
  dimensions?: number;
  model?: string;
}

interface MockEmbedCall {
  texts: string[];
  input_type: EmbeddingInputType;
}

class MockEmbedder implements Embedder {
  private _dimensions: number;
  private _model: string;
  private _calls: MockEmbedCall[];

  constructor(opts: MockEmbedderOpts = {}) {
    this._dimensions = opts.dimensions ?? _DEFAULT_DIMENSIONS;
    this._model = opts.model ?? _DEFAULT_MODEL;
    this._calls = [];
  }

  /*
   * (void) => readonly MockEmbedCall[]
   * The (texts, input_type) seen by each embed call, in order.
   * Pure
   * Public
   */
  public calls(): readonly MockEmbedCall[] {
    return this._calls;
  }

  /*
   * (void) => number
   * Pure
   * Public
   */
  public dimensions(): number {
    return this._dimensions;
  }

  /*
   * (void) => string
   * Pure
   * Public
   */
  public model(): string {
    return this._model;
  }

  /*
   * (string[], EmbeddingInputType) => Embedding[]
   * Record the call and return one deterministic unit vector per input.
   * Side Effect: records the call
   * Public
   */
  public async embed(
      texts: string[], input_type: EmbeddingInputType): Promise<Embedding[]> {
    this._calls.push({ texts, input_type });
    return texts.map((text) => _hash_embed(text, this._dimensions));
  }
}

/*
 * (string, number) => Embedding
 * Hash a text's tokens into buckets and L2-normalize.
 * Pure
 * Private
 */
function _hash_embed(text: string, dimensions: number): Embedding {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = text.toLowerCase()
                     .split(/[^a-z0-9]+/)
                     .filter((t) => t.length > 0);
  for (const token of tokens) {
    vector[_fnv1a(token) % dimensions] += 1;
  }
  let magnitude = 0;
  for (const weight of vector) magnitude += weight * weight;
  if (0 === magnitude) {
    vector[0] = 1;
    return vector;
  }
  magnitude = Math.sqrt(magnitude);
  for (let i = 0; i < vector.length; i++) {
    vector[i] /= magnitude;
  }
  return vector;
}

/*
 * (string) => number
 * FNV-1a over the string's code units, kept in unsigned 32-bit range. Chosen
 * for simplicity.
 * Pure
 * Private
 */
function _fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    // Multiply by the 32-bit FNV prime (16777619) using Math.imul to stay in
    // int32 lanes, then coerce back to unsigned.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// Matches the served default and the embeddings.embedding column. Swapping the
// mock for the real embedder needs no schema change.
const _DEFAULT_DIMENSIONS = 1024;
const _DEFAULT_MODEL = "mock-embedder";
