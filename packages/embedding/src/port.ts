export {
  EmbeddingInputType,
}
export type {
  Embedding,
  Embedder,
}

/*
 * The embedding port that adapters implement. Nothing in core depends on a
 * specific provider.
 *
 * Retrieval models are asymmetric: the same text embeds differently depending
 * on whether it is the thing being searched WITH or the thing being searched
 * OVER. Callers must say which, and each adapter applies whatever its provider
 * requires.
 */

type Embedding = number[];
enum EmbeddingInputType {
  Query = "query", // Text used to search
  Document = "document", // Entity being searched
}

interface Embedder {
  /*
   * (void) => number
   * Width of the vectors this embedder produces. Must match the width of the
   * column the vectors are stored in.
   */
  dimensions(): number;

  /*
   * (void) => string
   * Identifier recorded alongside every stored vector. Vectors produced by
   * different models share no coordinate space.
   */
  model(): string;

  /*
   * (string[], EmbeddingInputType) => Embedding[]
   * Embed a batch, returning one vector per input in the same order.
   */
  embed(texts: string[], input_type: EmbeddingInputType): Promise<Embedding[]>;
}
