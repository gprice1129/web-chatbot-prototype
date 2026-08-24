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
}
export type {
  GraphNode,
}

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines what a node of the knowledge graph is at the level of the
 * application. The vocabulary is asked, never enforced. A term is either
 * declared or it is not, and what an undeclared term means is left to the
 * caller.
 */

/*
 * Application Usage
 * -----------------------------------------------------------------------------
 * A node is classified by three facets -- type, level, and audiences -- placed
 * in its lifecycle by two independent answers, and connected to other nodes by
 * the relations its edges may be drawn from. The tools offer the facets to a
 * model as filter choices and name the relations to it; providers filter
 * GraphNodes by the facets and by whether a node is deprecated. Providers
 * produce GraphNodes and the tools consume them, so this module belongs to
 * neither side. It is a fixed point rather than a seam, and it imports nothing.
 *
 * Every term a caller states to anyone -- a model, a log, a person -- should be
 * read from here rather than retyped, so a vocabulary cannot be changed in one
 * place and left stale in another.
 *
 * The vocabularies are frozen because reading them means holding them: a tool
 * schema keeps the array itself, not a copy of it, so an unfrozen one would let
 * anything downstream edit what every other caller reads.
 *
 * The corpus is hand-authored and drifts. A loader warns on an undeclared term
 * and keeps the node. Drift costs a node its filters, not its existence.
 */

/*
 * Idea: The definition of a node at the domain layer.
 */
interface GraphNode {
  id: string;
  title: string;
  summary: string;
  // concept | skill | tool | risk | policy | case | module | track
  type: string;
  // foundational | applied | advanced; absent on modules and tracks.
  level: string | null;
  // Whether the writing is unfinished. A claim about the document, not about
  // the subject: the node may be a stub, so a reader should not lean on it.
  draft: boolean;
  // Whether what the node describes has been superseded. A claim about the
  // world, and the reason superseded_by exists: a deprecated node is a
  // signpost to its replacement, not material to teach from.
  deprecated: boolean;
  audiences: string[];
  aliases: string[];
  // relation -> target ids, the relation drawn from NODE_RELATIONS. Held as a
  // plain map because a node keeps whatever it was authored with, declared or
  // not. Single-target relations are normalized to arrays so callers never
  // branch on cardinality.
  edges: Record<string, string[]>;
  // The node's full text. Which markup it is written in is the provider's
  // business; the model reads it verbatim.
  body: string;
}

// What a node is. Given to the model as `type` choices so it filters with the
// corpus's own vocabulary instead of guessing.
const NODE_TYPES = Object.freeze([
  "concept", "skill", "tool", "risk", "policy", "case", "module", "track",
]);

// How advanced a node is. Absent on modules and tracks.
const NODE_LEVELS = Object.freeze(["foundational", "applied", "advanced"]);

/*
 * How a document declares its lifecycle in one word.
 *
 * A node does not carry this term. It answers `draft` and `deprecated`
 * separately, because the two say different kinds of thing -- one about the
 * writing, one about the world -- and a reader acts on them differently. The
 * single word is what an author writes; splitting it is the reader's gain.
 */
const NODE_STATUSES = Object.freeze(["draft", "current", "deprecated"]);

// Who a node was written for.
const NODE_AUDIENCES = Object.freeze([
  "public", "patient", "clinician", "researcher", "staff", "admin", "developer",
]);

/*
 * How one node may point at another.
 *
 * Unlike the facets above, this vocabulary classifies an edge rather than a
 * node, so nothing filters on it. It is here because a caller that tells a
 * model which edges it will receive must read the list rather than retype it.
 */
const NODE_RELATIONS = Object.freeze([
  "parent", "prerequisite", "next", "illustrates", "related",
  "superseded_by", "uses_tool", "warns_about", "governed_by",
]);

/*
 * The two declared terms that mean something a node must answer for. Named
 * here so whatever reads a document maps on the vocabulary rather than on a
 * string literal that nothing would catch drifting. A status that is neither
 * leaves both answers false.
 */
const NODE_STATUS_DRAFT = "draft";
const NODE_STATUS_DEPRECATED = "deprecated";

/*
 * Idea: Check if a node is of a given type
 *
 * (string) => boolean
 * Pure
 * Public
 */
function is_node_type(value: string): boolean {
  return NODE_TYPES.includes(value);
}

/*
 * Idea: Check if a node is of a given level
 * 
 * (string) => boolean
 * Pure
 * Public
 */
function is_node_level(value: string): boolean {
  return NODE_LEVELS.includes(value);
}

/*
 * Idea: Check if a node is of a given status
 *
 * (string) => boolean
 * Pure
 * Public
 */
function is_node_status(value: string): boolean {
  return NODE_STATUSES.includes(value);
}

/*
 * Idea: Check if a node is of a given audience
 *
 * (string) => boolean
 * Pure
 * Public
 */
function is_node_audience(value: string): boolean {
  return NODE_AUDIENCES.includes(value);
}
