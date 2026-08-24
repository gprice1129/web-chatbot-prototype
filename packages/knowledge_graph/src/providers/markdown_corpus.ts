export {
  load_markdown_corpus,
  _NON_NODE_FILES,
}

import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  separate_frontmatter,
  parse_frontmatter,
  type Result,
  type FrontmatterValue,
} from "common";

import {
  type GraphNode,
  is_node_type,
  is_node_level,
  is_node_status,
  is_node_audience,
  NODE_STATUS_DRAFT,
  NODE_STATUS_DEPRECATED,
} from "#kg/ontology.js";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines how a knowledge graph authored as a directory of markdown
 * documents is read into nodes. Reading is tolerant. A malformed document costs
 * that document and never the corpus. Every problem found is reported to
 * whoever asked for the reading, as it is found.
 */

/*
 * Application Usage
 * -----------------------------------------------------------------------------
 * One file is one node. The `edges` field of a file's frontmatter holds that
 * node's arcs. Reading a frontmatter block at all is `common`'s business, and
 * it knows nothing of nodes; this module decides which documents are nodes and
 * what their fields mean. It performs no retrieval and holds no index.
 *
 * Four conditions produce a warning rather than a failure: an unreadable file,
 * a document with no id, a duplicate id, and a facet the ontology does not
 * declare. A warning names the file it concerns, since a caller holding only
 * nodes has no way to trace one back.
 *
 * This module is the representation half of a provider, and the composition
 * root pairs it with a retrieval half. A representation sets an upper bound on
 * what retrieval can do. This format keeps title, aliases, summary and body as
 * separate fields, so a retriever may weight those fields separately. This
 * format keeps edges as a map, so a retriever may walk the edges. A store that
 * flattened a node into one text blob would support neither. Which retrieval
 * strategy runs within that bound is not decided here.
 */

/*
 * Idea: A directory of documents becomes the nodes it holds. What could not be
 * read is described to whoever asked for the reading, rather than stopping it.
 *
 * (string, (string) => void) => GraphNode[]
 * Documents that describe the graph, and documents with no id, yield no node.
 *
 * Use the `on_warning` handler to log issues on load or pass an empty handler
 * to silently ignore them.
 * Side Effect: reads the filesystem; calls on_warning
 * Public
 */
async function load_markdown_corpus(
    root: string, on_warning: (warning: string) => void): Promise<GraphNode[]> {
  const files = await _find_markdown_files(root);
  const nodes: GraphNode[] = [];
  // The value is the file that claimed an id first, so a duplicate can name it.
  const id_to_file = new Map<string, string>();
  for (const file of files.sort()) {
    if (!_is_node_file(file)) continue;
    const rel = path.relative(root, file);
    const read = await _read_node(file);
    if (!read.ok) {
      on_warning(`${rel}: ${read.error}`);
      continue;
    }
    const { node, declared_status } = read.value;
    if (id_to_file.has(node.id)) {
      on_warning(`duplicate id '${node.id}' at ${rel}; keeping ${id_to_file.get(node.id)}`);
      continue;
    }
    id_to_file.set(node.id, rel);
    for (const drift of _find_ontology_drift(rel, node, declared_status)) on_warning(drift);
    nodes.push(node);
  }
  return nodes;
}

/*
 * Idea: What one document turned out to hold: a node, and the lifecycle word
 * the document used to describe itself.
 *
 * A node answers `draft` and `deprecated` separately and keeps no single
 * status, so a term the ontology does not declare leaves no mark on it. The
 * word is carried this far, and no further, so it can be warned about.
 */
interface _ParsedDocument {
  node: GraphNode;
  declared_status: string;
}

/*
 * Idea: One document becomes one node, or says why it did not.
 *
 * (string) => Result<_ParsedDocument>
 * Side Effect: reads the filesystem
 * Private
 */
async function _read_node(file: string): Promise<Result<_ParsedDocument>> {
  let node_document: string;
  try {
    node_document = await fs.readFile(file, "utf8");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `unreadable (${reason})` };
  }
  const parsed = _parse_document(node_document);
  if (!parsed.ok) return parsed;
  if ("" === parsed.value.node.id) {
    return { ok: false, error: "no 'id' declared; skipped" };
  }
  return parsed;
}

/*
 * Idea: The boundary where a document stops being a file and becomes a node of
 * the domain.
 *
 * (string) => Result<_ParsedDocument>
 * Every coercion the ontology needs happens here, so a caller never has to know
 * the shape of the document. A lifecycle word the ontology does not declare
 * leaves the node neither draft nor deprecated, which is how an unreadable term
 * has always been treated: the node stays as findable as any other.
 *
 * A metadata block the grammar rejects fails the whole document. That is the
 * parser's judgement, passed along unchanged; what failing costs is decided
 * further up.
 *
 * A document with no id yields a node with an empty one, for the caller to
 * reject.
 * Pure
 * Private
 */
function _parse_document(node_document: string): Result<_ParsedDocument> {
  const { frontmatter, body } = separate_frontmatter(node_document);
  const parsed = parse_frontmatter(frontmatter);
  if (!parsed.ok) return parsed;
  const fields = parsed.value;
  const id = _as_string(fields["id"]).trim();
  const declared_status = _as_string(fields["status"]).trim();
  return {
    ok: true,
    value: {
      declared_status,
      node: {
        id,
        title:      _as_string(fields["title"]).trim() || id,
        summary:    _as_string(fields["summary"]).trim(),
        type:       _as_string(fields["type"]).trim(),
        level:      _as_string(fields["level"]).trim() || null,
        draft:      NODE_STATUS_DRAFT === declared_status,
        deprecated: NODE_STATUS_DEPRECATED === declared_status,
        audiences:  _as_list(fields["audiences"]),
        aliases:    _as_list(fields["aliases"]),
        edges:      _read_edges(fields["edges"]),
        body:       body.trim(),
      },
    },
  };
}

/*
 * Idea: A node's arcs out to other nodes, however the author chose to write
 * them.
 *
 * (FrontmatterValue | undefined) => Record<string, string[]>
 * Anything that is not a map of relations yields no edges, `edges:` declared
 * with nothing under it included -- that arrives as null, which is an object as
 * far as typeof is concerned and would otherwise be walked as one.
 * Pure
 * Private
 */
function _read_edges(raw: FrontmatterValue | undefined): Record<string, string[]> {
  const edges: Record<string, string[]> = {};
  if (undefined === raw || null === raw
      || Array.isArray(raw) || "object" !== typeof raw) {
    return edges;
  }
  for (const [relation, target] of Object.entries(raw)) {
    edges[relation] = _as_list(target);
  }
  return edges;
}

/*
 * Idea: Where what a node claims about itself and what the vocabulary allows
 * have drifted apart.
 *
 * (string, GraphNode, string) => string[]
 * The lifecycle word comes in separately because it is the one facet the node
 * does not carry: by the time a node exists the term has already become two
 * booleans, and an undeclared one is indistinguishable from `current`.
 *
 * These are warnings rather than rejections: the corpus is hand-authored, and a
 * mistyped facet should cost the node its filters, not its existence -- it is
 * still reachable by text search.
 *
 * A level is the one facet that may be absent. The ontology puts one on every
 * atom but not on the modules and tracks that contain them.
 * Pure
 * Private
 */
function _find_ontology_drift(
    rel: string, node: GraphNode, declared_status: string): string[] {
  const found: string[] = [];
  if ("" === node.type) {
    found.push(`${rel}: no 'type' declared; not filterable by type`);
  } else if (!is_node_type(node.type)) {
    found.push(`${rel}: unknown type '${node.type}'; not filterable by type`);
  }
  if (null !== node.level && !is_node_level(node.level)) {
    found.push(`${rel}: unknown level '${node.level}'; not filterable by level`);
  }
  if ("" === declared_status) {
    found.push(`${rel}: no 'status' declared`);
  } else if (!is_node_status(declared_status)) {
    found.push(`${rel}: unknown status '${declared_status}'`);
  }
  if (0 === node.audiences.length) {
    found.push(`${rel}: no 'audiences' declared; not filterable by audience`);
  }
  for (const audience of node.audiences) {
    if (!is_node_audience(audience)) {
      found.push(`${rel}: unknown audience '${audience}'; not filterable by audience`);
    }
  }
  return found;
}

/*
 * Idea: Every candidate document beneath a starting point, however deeply
 * nested.
 *
 * (string) => string[]
 * Paths are relative or absolute according to the root they were found from.
 * Side Effect: reads the filesystem
 * Private
 */
async function _find_markdown_files(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...await _find_markdown_files(full));
      continue;
    }
    if (entry.isFile() && full.endsWith(".md")) {
      found.push(full);
    }
  }
  return found;
}

/*
 * Idea: Telling a node of the graph apart from a document that describes the
 * graph.
 *
 * (string) => boolean
 * Matched on name alone, so an excluded document is excluded at any depth.
 * Pure
 * Private
 */
function _is_node_file(file: string): boolean {
  return !_NON_NODE_FILES.has(path.basename(file));
}

/*
 * Idea: Whatever a field declared, read as a single piece of text.
 *
 * (FrontmatterValue | undefined) => string
 * A nested map yields nothing rather than its default rendering, which would
 * put a meaningless string where a field was expected.
 * Pure
 * Private
 */
function _as_string(value: FrontmatterValue | undefined): string {
  if (undefined === value || null === value) return "";
  if (Array.isArray(value)) return value.join(", ");
  if ("object" === typeof value) return "";
  return String(value);
}

/*
 * Idea: Whatever a field declared, read as a list of names.
 *
 * (FrontmatterValue | undefined) => string[]
 * A field written as one bare value and one written as a list read the same, so
 * nothing downstream branches on cardinality.
 * Pure
 * Private
 */
function _as_list(value: FrontmatterValue | undefined): string[] {
  if (undefined === value || null === value) return [];
  if (Array.isArray(value)) return value.map((v) => String(v)).filter((s) => "" !== s);
  const single = String(value).trim();
  return "" === single ? [] : [single];
}

/*
 * Idea: Documents that describe the graph rather than being part of it.
 */
const _NON_NODE_FILES = new Set([
  "ONTOLOGY.md",
  "TAXONOMY.md",
  "GRAPH.md",
  "INDEX.md",
  "README.md",
]);
