export type {
  SearchFilters,
  KnowledgeGraphSource,
}

import type { GraphNode } from "#kg/ontology.js";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines what any supplier of knowledge graph nodes must be able to
 * do:
 *   1. Match a query to the nodes that best answer it. 
 *   2. Open a node named by identity.
 *
 * Only outcomes are constrained. How a supplier holds or ranks its nodes is
 * deliberately absent, and no trace of that ranking reaches a caller.
 */

/*
 * Application Usage
 * -----------------------------------------------------------------------------
 * This port is the provider-facing half of the knowledge graph tool.
 * Implementations of the port live under providers/, and the composition root
 * chooses one.
 *
 * The port's signature cannot express the promises the tools make to a model on
 * a provider's behalf: search matches aliases as well as titles, an exact id
 * outranks accumulated overlap, and the ontology facets are honoured. */

/*
 * Idea: The shape of a search query over the knowledge graph
 */
interface SearchFilters {
  limit: number;
  types?: string[];
  levels?: string[];
  audiences?: string[];
  // Deprecated nodes are excluded by default: they exist to carry a
  // superseded_by pointer, not to be taught from.
  include_deprecated?: boolean;
}

/*
 * Idea: A port that defines the interface over the knowledge graph.
 */
interface KnowledgeGraphSource {
  // Nodes matching a query, best first, at most `filters.limit` of them.
  search(query: string, filters: SearchFilters): Promise<GraphNode[]>;
  // One node by id, falling back to an exact title or alias; null if unknown.
  get(id: string): Promise<GraphNode | null>;
}
