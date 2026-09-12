// Read a knowledge corpus into its nodes, the way the validators need it.
//
// Documents are found and read through `common`, exactly as the app reads
// them, so a document the app would refuse is refused here too. Each
// validator decides what to do with a refusal; this module only reports it.

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { find_markdown, read_markdown, list_files, ok_or_throw } from "common";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_ROOT = path.join(REPO_ROOT, "packages", "static", "knowledge");

// Documents that describe the graph rather than being part of it.
export const NON_NODE_FILES = new Set(["ONTOLOGY.md", "TAXONOMY.md", "GRAPH.md", "INDEX.md", "README.md"]);

// A field that may be one name or a list of names, as a list.
export function as_list(value) {
  if (undefined === value || null === value) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

// The corpus root named by --root, or the default.
export function root_from_argv(argv) {
  const at = argv.indexOf("--root");
  if (-1 === at) return DEFAULT_ROOT;
  return path.resolve(argv[at + 1]);
}

// Every node document under the root: { id -> fields }, { id -> file path },
// and the problems that stopped a document from becoming a node.
export async function read_nodes(root) {
  const nodes = {};
  const files = {};
  const problems = [];
  const found = ok_or_throw(await find_markdown(root), root);
  for (const file of list_files(found)) {
    const name = path.basename(file);
    if (NON_NODE_FILES.has(name)) continue;
    const read = await read_markdown(file);
    if (!read.ok) {
      problems.push({ file, message: read.error });
      continue;
    }
    const fields = read.value.fields;
    const id = fields.id;
    if (!id) {
      problems.push({ file, message: "missing required field 'id'" });
      continue;
    }
    if (id in nodes) {
      problems.push({ file, message: `duplicate id '${id}' (also in ${files[id]})` });
    }
    nodes[id] = fields;
    files[id] = file;
  }
  return { nodes, files, problems };
}

// The subject directory a node file belongs to, relative to the root.
export function subject_of(root, file) {
  const relative = path.relative(root, file);
  return relative.split(path.sep)[0];
}
