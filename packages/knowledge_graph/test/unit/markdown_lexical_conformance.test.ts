import {
  KB_ROOT,
  describe_knowledge_graph_source,
} from "../support/conformance.ts";
import { load_markdown_corpus } from "#kg/providers/markdown_corpus.js";
import { LexicalGraph } from "#kg/providers/lexical_graph.js";

/*
 * The markdown + lexical provider against the shared port contract.
 *
 * This is the whole cost of adding a provider: compose its two halves into a
 * KnowledgeGraphSource and hand the factory to the suite. A provider that
 * cannot split that way -- one whose store does its own ranking -- returns its
 * single object from the factory instead, and the suite does not notice.
 */
describe_knowledge_graph_source("markdown + lexical", async () => {
  const nodes = await load_markdown_corpus(KB_ROOT, () => {});
  return new LexicalGraph(nodes);
});
