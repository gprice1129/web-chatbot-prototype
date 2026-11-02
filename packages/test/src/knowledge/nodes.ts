// Read a knowledge corpus into its nodes

import * as path from "node:path";
import { find_markdown, read_markdown, list_files, ok_or_throw, is_object } from "common";
import type { FrontmatterMap } from "common";
import { NON_NODE_FILES } from "knowledge_graph";

// A node is its frontmatter, as read, with its body kept beside it for the
// checks that read sections. Validators check the shape; nothing here does.
export interface Corpus {
  nodes: Record<string, FrontmatterMap>;
  bodies: Record<string, string>;
  files: Record<string, string>;
  problems: { file: string; message: string }[];
}

// A node's edges field, as a map of relation to raw target value.
export function edges_of(fields: FrontmatterMap): FrontmatterMap {
  const edges = fields.edges;
  if (is_object(edges)) return edges;
  return {};
}

// The corpus root named by --root. There is no default: the package scripts
// name the corpus, so a validator never guesses where it is.
export function root_from_argv(argv: string[]): string {
  const at = argv.indexOf("--root");
  const root = argv[at + 1];
  if (-1 === at || undefined === root) {
    throw new Error("--root <corpus directory> is required");
  }
  return path.resolve(root);
}

// Every node document under the root: { id -> fields }, { id -> file path },
// and the problems that stopped a document from becoming a node.
export async function read_nodes(root: string): Promise<Corpus> {
  const corpus: Corpus = { nodes: {}, bodies: {}, files: {}, problems: [] };
  const found = ok_or_throw(await find_markdown(root), root);
  for (const file of list_files(found)) {
    const name = path.basename(file);
    if (NON_NODE_FILES.has(name)) continue;
    const read = await read_markdown(file);
    if (!read.ok) {
      corpus.problems.push({ file, message: read.error });
      continue;
    }
    const fields = read.value.fields;
    const id = fields.id;
    if ("string" !== typeof id || "" === id) {
      corpus.problems.push({ file, message: "missing required field 'id'" });
      continue;
    }
    if (id in corpus.nodes) {
      corpus.problems.push({ file, message: `duplicate id '${id}' (also in ${corpus.files[id]})` });
    }
    corpus.nodes[id] = fields;
    corpus.bodies[id] = read.value.body;
    corpus.files[id] = file;
  }
  return corpus;
}
