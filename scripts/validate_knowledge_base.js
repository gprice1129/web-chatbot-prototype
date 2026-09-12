#!/usr/bin/env node
// CI gate for the knowledge base. Exit 1 on any error.
//
// This is what keeps the ontology honest. A taxonomy nobody enforces decays
// into a misleading map, which is worse than no map at all.
//
//   node scripts/validate_knowledge_base.js            errors only
//   node scripts/validate_knowledge_base.js --warn     errors and warnings
//   node scripts/validate_knowledge_base.js --root X   another corpus
//
// Documents are found and read through `common`, exactly as the app reads
// them, so a document the app would refuse is an error here too.

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { find_markdown, read_markdown, list_files, ok_or_throw } from "common";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_ROOT = path.join(REPO_ROOT, "packages", "static", "knowledge");

const ATOM_TYPES = new Set(["concept", "skill", "tool", "risk", "policy", "case"]);
const COMP_TYPES = new Set(["module", "track"]);
const REQUIRED = ["id", "title", "summary", "type", "audiences", "owner", "reviewed", "status"];
const RELATIONS = new Set([
  "parent", "prerequisite", "next", "related", "illustrates",
  "superseded_by", "uses_tool", "warns_about", "governed_by",
]);
const STALE_DAYS = { high: 90, medium: 180, low: 365 };

// Which relations may point at which target types.
const TARGET_TYPES = {
  parent: new Set(["module"]),
  uses_tool: new Set(["tool"]),
  warns_about: new Set(["risk"]),
  governed_by: new Set(["policy"]),
  illustrates: new Set(["concept", "skill", "tool", "risk", "policy"]),
};

// Documents that describe the graph rather than being part of it.
const NON_NODE_FILES = new Set(["ONTOLOGY.md", "TAXONOMY.md", "GRAPH.md", "INDEX.md", "README.md"]);

const errors = [];
const warnings = [];
function err(file, message) { errors.push(`ERROR  ${file}: ${message}`); }
function warn(file, message) { warnings.push(`WARN   ${file}: ${message}`); }

// A field that may be one name or a list of names, as a list.
function as_list(value) {
  if (undefined === value || null === value) return [];
  if (Array.isArray(value)) return value.map(String);
  return [String(value)];
}

// Whether a value is an ISO date the calendar accepts.
function parse_iso_date(value) {
  const text = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.toISOString().slice(0, 10) !== text) return null;
  return date;
}

// Read every node document into { id -> fields } and { id -> file name }.
async function read_nodes(root) {
  const nodes = {};
  const files = {};
  const found = ok_or_throw(await find_markdown(root), root);
  for (const file of list_files(found)) {
    const name = path.basename(file);
    if (NON_NODE_FILES.has(name)) continue;
    const read = await read_markdown(file);
    if (!read.ok) {
      err(name, read.error);
      continue;
    }
    const fields = read.value.fields;
    for (const key of REQUIRED) {
      if (!(key in fields)) err(name, `missing required field '${key}'`);
    }
    const id = fields.id;
    if (!id) continue;
    const expected = name.slice(0, -".md".length);
    if (id !== expected && `track-${expected}` !== id) {
      err(name, `id '${id}' does not match filename`);
    }
    if (id in nodes) err(name, `duplicate id '${id}' (also in ${files[id]})`);
    nodes[id] = fields;
    files[id] = name;
  }
  return { nodes, files };
}

// Every edge resolves and points at a legal target type.
function check_edges(name, edges, nodes) {
  for (const [relation, target] of Object.entries(edges)) {
    if (!RELATIONS.has(relation)) {
      err(name, `unknown relation '${relation}' -- see ONTOLOGY.md section 4`);
      continue;
    }
    for (const id of as_list(target)) {
      if (!(id in nodes)) {
        err(name, `${relation} -> '${id}' does not resolve`);
      } else if (relation in TARGET_TYPES && !TARGET_TYPES[relation].has(nodes[id].type)) {
        const allowed = [...TARGET_TYPES[relation]].join("|");
        err(name, `${relation} -> '${id}' is type '${nodes[id].type}', expected ${allowed}`);
      }
    }
  }
}

// What each type must declare beyond the shared required fields.
function check_structure(name, fields, edges, summary) {
  const type = fields.type;
  if (ATOM_TYPES.has(type)) {
    if (!("parent" in edges)) err(name, "atom has no parent module (orphan)");
    if (!("level" in fields)) err(name, "atom missing 'level'");
  }
  if ("tool" === type) {
    if (!(fields.volatility in STALE_DAYS)) err(name, "tool must declare volatility: high|medium|low");
    if ("high" === fields.volatility && !fields.verified_against) {
      err(name, "high-volatility tool must declare verified_against");
    }
  }
  if ("case" === type) {
    if (!fields.contains_worked_failure) {
      err(name, "case must declare contains_worked_failure");
    } else if (0 === as_list(edges.warns_about).length) {
      err(name, "case with a worked failure must declare warns_about -- "
        + "the failure must instantiate a risk atom");
    }
    if (!("illustrates" in edges)) err(name, "case must illustrate at least one atom");
    if (!summary.toLowerCase().includes("fail") && !summary.includes("TODO")) {
      warn(name, "case summary should signal that it contains a worked failure");
    }
  }
  if (COMP_TYPES.has(type) && !fields.objectives) err(name, `${type} must declare objectives`);
  if ("deprecated" === fields.status && !("superseded_by" in edges)) {
    err(name, "deprecated node must declare superseded_by");
  }
}

// Placeholders, overlong summaries, drafts, and reviews past their shelf life.
function check_content(name, fields, summary, today) {
  if (summary.includes("TODO") || "" === summary) {
    warn(name, "summary is a placeholder -- search returns this, nothing else");
  }
  const words = summary.split(/\s+/).filter((w) => "" !== w).length;
  if (words > 60 && "case" !== fields.type) {
    warn(name, `summary is ${words} words; aim for 1-2 sentences`);
  }
  if ("draft" === fields.status) warn(name, "still draft");
  const reviewed = parse_iso_date(fields.reviewed);
  if (null === reviewed) {
    err(name, "reviewed must be an ISO date (YYYY-MM-DD)");
    return;
  }
  const limit = STALE_DAYS[fields.volatility ?? "low"] ?? 365;
  const age = Math.floor((today - reviewed) / 86_400_000);
  if (age > limit) {
    warn(name, `reviewed ${age}d ago; limit for this volatility is ${limit}d (owner: ${fields.owner})`);
  }
}

// A module's `contains` list agrees with the atoms that claim it as parent.
function check_containment(nodes, files) {
  for (const [id, fields] of Object.entries(nodes)) {
    if ("module" !== fields.type) continue;
    const declared = new Set(as_list(fields.contains));
    const actual = new Set(Object.entries(nodes)
      .filter(([, f]) => as_list((f.edges ?? {}).parent).includes(id))
      .map(([atom]) => atom));
    for (const missing of declared) {
      if (!actual.has(missing)) err(files[id], `contains '${missing}' but that node's parent edge disagrees`);
    }
    for (const extra of actual) {
      if (!declared.has(extra)) warn(files[id], `'${extra}' claims this parent but is not in contains`);
    }
  }
}

// Every module is reachable from some track.
function check_coverage(nodes, files) {
  const covered = new Set();
  for (const fields of Object.values(nodes)) {
    if ("track" !== fields.type) continue;
    for (const next of as_list((fields.edges ?? {}).next)) covered.add(next);
  }
  for (const [id, fields] of Object.entries(nodes)) {
    if ("module" === fields.type && !covered.has(id)) {
      warn(files[id], "module is not referenced by any track");
    }
  }
}

async function main(argv) {
  const root_at = argv.indexOf("--root");
  const root = -1 === root_at ? DEFAULT_ROOT : path.resolve(argv[root_at + 1]);
  const show_warnings = argv.includes("--warn");
  const today = new Date();

  const { nodes, files } = await read_nodes(root);
  for (const [id, fields] of Object.entries(nodes)) {
    const name = files[id];
    if (!ATOM_TYPES.has(fields.type) && !COMP_TYPES.has(fields.type)) {
      err(name, `unknown type '${fields.type}'`);
      continue;
    }
    const edges = fields.edges ?? {};
    const summary = String(fields.summary ?? "").trim();
    check_edges(name, edges, nodes);
    check_structure(name, fields, edges, summary);
    check_content(name, fields, summary, today);
  }
  check_containment(nodes, files);
  check_coverage(nodes, files);

  const by_type = {};
  for (const fields of Object.values(nodes)) {
    by_type[fields.type] = (by_type[fields.type] ?? 0) + 1;
  }
  const counts = Object.entries(by_type).sort().map(([type, n]) => `${type} ${n}`).join(", ");
  console.log(`${Object.keys(nodes).length} nodes: ${counts}`);
  for (const line of errors) console.log(line);
  if (show_warnings) for (const line of warnings) console.log(line);
  const hint = show_warnings ? "" : "  (--warn to list)";
  console.log(`\n${errors.length} errors, ${warnings.length} warnings${hint}`);
  return 0 === errors.length ? 0 : 1;
}

process.exitCode = await main(process.argv.slice(2));
