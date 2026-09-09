/*
 * A knowledge graph: what a node is, what any source of nodes must be able to
 * answer, and the providers that answer it.
 */

// What a node is, and the corpus's vocabularies.
export {
  NODE_TYPES,
  NODE_LEVELS,
  NODE_STATUSES,
  NODE_AUDIENCES,
  NODE_RELATIONS,
  NODE_STATUS_DRAFT,
  NODE_STATUS_DEPRECATED,
  is_node_type,
  is_node_level,
  is_node_status,
  is_node_audience,
} from "#kg/ontology.js";

export type {
  GraphNode,
} from "#kg/ontology.js";

// The port. What a provider must be able to answer, said in outcomes rather
// than in method: nodes in, nodes out.
export type {
  SearchFilters,
  KnowledgeGraphSource,
} from "#kg/port.js";

// Provider: markdown + frontmatter representation, lexical retrieval. Two
// halves of one provider, composed at the call site.
export {
  load_markdown_corpus,
} from "#kg/providers/markdown_corpus.js";

export {
  LexicalGraph,
} from "#kg/providers/lexical_graph.js";

export type {
  SearchHit,
} from "#kg/providers/lexical_graph.js";
