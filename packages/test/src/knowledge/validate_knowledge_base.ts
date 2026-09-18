// CI gate for the knowledge base. Exit 1 on any error.
//
// This is what keeps the ontology honest. A taxonomy nobody enforces decays
// into a misleading map, which is worse than no map at all.
//
//   npm run validate-knowledge-base                 errors only
//   npm run validate-knowledge-base -- --warn       errors and warnings
//
// The corpus is named by --root; the package script supplies it.

import * as path from "node:path";
import { as_list, parse_iso_date } from "common";
import type { FrontmatterMap } from "common";
import { NODE_AUDIENCES } from "knowledge_graph";
import { read_nodes as read_corpus, root_from_argv, edges_of } from "./nodes.js";

const ATOM_TYPES = new Set(["concept", "skill", "tool", "risk", "policy", "case"]);
const COMP_TYPES = new Set(["module", "track"]);
const REQUIRED = ["id", "title", "summary", "type", "audiences", "owner", "reviewed", "status"];
const RELATIONS = new Set([
  "parent", "prerequisite", "next", "related", "illustrates",
  "superseded_by", "uses_tool", "warns_about", "governed_by",
]);
const STALE_DAYS: Record<string, number> = { high: 90, medium: 180, low: 365 };

// Which relations may point at which target types.
const TARGET_TYPES: Record<string, Set<string>> = {
  parent: new Set(["module"]),
  uses_tool: new Set(["tool"]),
  warns_about: new Set(["risk"]),
  governed_by: new Set(["policy"]),
  illustrates: new Set(["concept", "skill", "tool", "risk", "policy"]),
};

type Nodes = Record<string, FrontmatterMap>;
type Bodies = Record<string, string>;
type Files = Record<string, string>;

const errors: string[] = [];
const warnings: string[] = [];
function err(file: string, message: string): void { errors.push(`ERROR  ${file}: ${message}`); }
function warn(file: string, message: string): void { warnings.push(`WARN   ${file}: ${message}`); }

// Every node document as { id -> fields } and { id -> file name }, with the
// required fields and the id-equals-filename rule checked on the way in.
async function read_nodes(root: string): Promise<{ nodes: Nodes; bodies: Bodies; files: Files }> {
  const corpus = await read_corpus(root);
  for (const problem of corpus.problems) err(path.basename(problem.file), problem.message);
  const files: Files = {};
  for (const [id, file] of Object.entries(corpus.files)) {
    const name = path.basename(file);
    files[id] = name;
    const fields = corpus.nodes[id];
    for (const key of REQUIRED) {
      if (!(key in fields)) err(name, `missing required field '${key}'`);
    }
    const expected = name.slice(0, -".md".length);
    if (id !== expected) {
      err(name, `id '${id}' does not match filename`);
    }
  }
  return { nodes: corpus.nodes, bodies: corpus.bodies, files };
}

// Every edge resolves and points at a legal target type.
function check_edges(name: string, edges: FrontmatterMap, nodes: Nodes): void {
  for (const [relation, target] of Object.entries(edges)) {
    if (!RELATIONS.has(relation)) {
      err(name, `unknown relation '${relation}' -- see ONTOLOGY.md section 4`);
      continue;
    }
    for (const id of as_list(target)) {
      if (!(id in nodes)) {
        err(name, `${relation} -> '${id}' does not resolve`);
      } else if (relation in TARGET_TYPES && !TARGET_TYPES[relation].has(String(nodes[id].type))) {
        const allowed = [...TARGET_TYPES[relation]].join("|");
        err(name, `${relation} -> '${id}' is type '${nodes[id].type}', expected ${allowed}`);
      }
    }
  }
}

// The text under one level-two heading, up to the next one; "" if absent.
function section_of(body: string, heading: string): string {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (-1 === start) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  if (-1 === end) return rest.join("\n");
  return rest.slice(0, end).join("\n");
}

// What each type must declare beyond the shared required fields.
function check_structure(name: string, fields: FrontmatterMap, edges: FrontmatterMap, summary: string, body: string): void {
  const type = String(fields.type);
  if (ATOM_TYPES.has(type)) {
    if (!("parent" in edges)) err(name, "atom has no parent module (orphan)");
    if (!("level" in fields)) err(name, "atom missing 'level'");
  }
  if ("tool" === type) {
    if (!(String(fields.volatility) in STALE_DAYS)) err(name, "tool must declare volatility: high|medium|low");
    if ("high" === fields.volatility && !fields.verified_against) {
      err(name, "high-volatility tool must declare verified_against");
    }
    const verified = String(fields.verified_against ?? "");
    if (verified.includes("TODO") || verified.includes("FILL")) {
      warn(name, "verified_against is a placeholder -- name the source and month the claims were checked against");
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
    const failed_run = section_of(body, "The failed run");
    if ("" === failed_run.trim()) {
      warn(name, "case has no failed run section -- the flag promises one");
    } else if (failed_run.includes("TODO")) {
      warn(name, "failed run is a placeholder -- the flag promises a worked failure");
    }
    if (!summary.toLowerCase().includes("fail") && !summary.includes("TODO")) {
      warn(name, "case summary should signal that it contains a worked failure");
    }
  }
  for (const audience of as_list(fields.audiences)) {
    if (!NODE_AUDIENCES.includes(audience)) {
      err(name, `audience '${audience}' is not in the vocabulary: ${NODE_AUDIENCES.join("|")}`);
    }
  }
  if (COMP_TYPES.has(type) && !fields.objectives) err(name, `${type} must declare objectives`);
  if ("deprecated" === fields.status && !("superseded_by" in edges)) {
    err(name, "deprecated node must declare superseded_by");
  }
}

// Placeholders, overlong summaries, drafts, and reviews past their shelf life.
function check_content(name: string, fields: FrontmatterMap, summary: string, today: Date): void {
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
  const limit = STALE_DAYS[String(fields.volatility ?? "low")] ?? 365;
  const age = Math.floor((today.getTime() - reviewed.getTime()) / 86_400_000);
  if (age > limit) {
    warn(name, `reviewed ${age}d ago; limit for this volatility is ${limit}d (owner: ${fields.owner})`);
  }
}

// A module's `contains` list agrees with the atoms that claim it as parent.
function check_containment(nodes: Nodes, files: Files): void {
  for (const [id, fields] of Object.entries(nodes)) {
    if ("module" !== fields.type) continue;
    const declared = new Set(as_list(fields.contains));
    const actual = new Set(Object.entries(nodes)
      .filter(([, f]) => as_list(edges_of(f).parent).includes(id))
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
function check_coverage(nodes: Nodes, files: Files): void {
  const covered = new Set<string>();
  for (const fields of Object.values(nodes)) {
    if ("track" !== fields.type) continue;
    for (const next of as_list(edges_of(fields).next)) covered.add(next);
  }
  for (const [id, fields] of Object.entries(nodes)) {
    if ("module" === fields.type && !covered.has(id)) {
      warn(files[id], "module is not referenced by any track");
    }
  }
}

async function main(argv: string[]): Promise<number> {
  const root = root_from_argv(argv);
  const show_warnings = argv.includes("--warn");
  const today = new Date();

  const { nodes, bodies, files } = await read_nodes(root);
  for (const [id, fields] of Object.entries(nodes)) {
    const name = files[id];
    const type = String(fields.type);
    if (!ATOM_TYPES.has(type) && !COMP_TYPES.has(type)) {
      err(name, `unknown type '${fields.type}'`);
      continue;
    }
    const edges = edges_of(fields);
    const summary = String(fields.summary ?? "").trim();
    check_edges(name, edges, nodes);
    check_structure(name, fields, edges, summary, bodies[id]);
    check_content(name, fields, summary, today);
  }
  check_containment(nodes, files);
  check_coverage(nodes, files);

  const by_type: Record<string, number> = {};
  for (const fields of Object.values(nodes)) {
    const type = String(fields.type);
    by_type[type] = (by_type[type] ?? 0) + 1;
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
