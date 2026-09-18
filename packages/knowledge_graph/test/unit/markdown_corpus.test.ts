import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import {
  load_markdown_corpus,
  NON_NODE_FILES,
} from "#kg/providers/markdown_corpus.js";
import type { GraphNode } from "#kg/ontology.js";
import { KB_ROOT, KB_NODE_COUNT } from "../support/conformance.ts";

// Collecting the warnings is this test's business, not the loader's: it hands
// each one to a sink and keeps none.
async function load(root: string): Promise<{ nodes: GraphNode[], warnings: string[] }> {
  const warnings: string[] = [];
  const nodes = await load_markdown_corpus(root, (w) => warnings.push(w));
  return { nodes, warnings };
}

const corpus = await load(KB_ROOT);

function node(id: string): GraphNode {
  const found = corpus.nodes.find((n) => id === n.id);
  assert.ok(undefined !== found, `fixture corpus has no node '${id}'`);
  return found;
}

describe("load_markdown_corpus", () => {
  it("loads every node file and nothing else", () => {
    assert.equal(corpus.nodes.length, KB_NODE_COUNT);
    assert.equal(corpus.nodes.some((n) => "readme-impostor" === n.id), false);
    for (const name of NON_NODE_FILES) {
      assert.equal(corpus.warnings.some((w) => w.includes(name)), false, name);
    }
    for (const warning of corpus.warnings) {
      assert.match(warning, /(broken|malformed)\.md/);
    }
  });

  it("skips a file with no frontmatter and says which", () => {
    assert.equal(corpus.nodes.some((n) => "broken" === n.id), false);
    assert.equal(corpus.warnings.some((w) => w.includes("broken.md")), true);
  });

  it("forwards a parse failure as one document's warning", () => {
    assert.equal(corpus.nodes.some((n) => "malformed-node" === n.id), false);
    const failed = corpus.warnings.filter((w) => w.includes("malformed.md"));
    assert.equal(failed.length, 1);
    assert.match(failed[0], /^atoms\/malformed\.md: frontmatter line \d+: \S/);
  });

  it("normalizes frontmatter into the ontology node shape", () => {
    const risk = node("hallucinated-citations");
    assert.equal(risk.title, "Fabricated citations");
    assert.equal(risk.type, "risk");
    assert.equal(risk.level, "foundational");
    assert.equal(risk.draft, false);
    assert.equal(risk.deprecated, false);
    assert.match(risk.summary, /^Language models invent plausible-looking references/);
    assert.deepEqual(risk.aliases, ["fake references", "bogus citations", "made-up sources"]);
    assert.deepEqual(risk.edges["parent"], ["m03-evaluating-ai-output"]);
    assert.deepEqual(risk.edges["governed_by"], ["phi-and-hipaa-in-ai-tools"]);
    assert.match(risk.body, /^# Fabricated citations/);
  });

  it("keeps a node's place in the corpus only as its subject, never as a path", () => {
    const risk = node("hallucinated-citations");
    assert.deepEqual(
      Object.keys(risk).sort(),
      ["aliases", "audiences", "body", "deprecated", "draft", "edges", "id",
       "level", "subject", "summary", "title", "type"]);
  });

  it("reads a flat corpus as having no subject", () => {
    assert.equal(node("hallucinated-citations").subject, "");
    assert.equal(node("m07-media-and-transcription").subject, "");
  });

  it("reads the subject from the directory above a node's role directory", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "kg-subjects-"));
    try {
      const source = path.join(KB_ROOT, "atoms", "whisper.md");
      for (const [subject, name] of [["ai", "whisper.md"], ["uab/it", "whisper.md"]]) {
        await fs.mkdir(path.join(root, subject, "atoms"), { recursive: true });
        await fs.copyFile(source, path.join(root, subject, "atoms", name));
      }
      const { nodes, warnings } = await load(root);
      // The two copies share an id, so the loader keeps the first and warns.
      assert.equal(warnings.length, 1);
      assert.deepEqual(nodes.map((n) => n.subject), ["ai"]);
      const only_uab = await load(path.join(root, "uab"));
      assert.deepEqual(only_uab.nodes.map((n) => n.subject), ["it"]);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

describe("load_markdown_corpus ontology drift", () => {
  const DRIFT_ROOT = path.join(import.meta.dirname, "..", "fixtures", "kb_drift");

  it("names every facet the ontology does not declare", async () => {
    const { warnings } = await load(DRIFT_ROOT);
    const drifted = warnings.filter((w) => w.includes("drifted.md"));
    assert.deepEqual(drifted.sort(), [
      "drifted.md: unknown audience 'wizard'; not filterable by audience",
      "drifted.md: unknown level 'expert'; not filterable by level",
      "drifted.md: unknown status 'retired'",
      "drifted.md: unknown type 'widget'; not filterable by type",
    ]);
  });

  it("says nothing about a node whose facets all conform", async () => {
    const { warnings } = await load(DRIFT_ROOT);
    assert.deepEqual(warnings.filter((w) => w.includes("clean.md")), []);
  });

  it("names a required facet that was never declared", async () => {
    const { warnings } = await load(DRIFT_ROOT);
    const missing = warnings.filter((w) => w.includes("missing.md"));
    assert.deepEqual(missing.sort(), [
      "missing.md: no 'audiences' declared; not filterable by audience",
      "missing.md: no 'status' declared",
      "missing.md: no 'type' declared; not filterable by type",
    ]);
  });

  it("keeps the drifted node, with its terms unchanged", async () => {
    const { nodes } = await load(DRIFT_ROOT);
    assert.deepEqual(
      nodes.map((n) => n.id).sort(),
      ["clean-node", "drifted-node", "missing-facets"]);
    const drifted = nodes.find((n) => "drifted-node" === n.id);
    assert.ok(undefined !== drifted);
    assert.equal(drifted.type, "widget");
    assert.equal(drifted.level, "expert");
    assert.equal(drifted.draft, false);
    assert.equal(drifted.deprecated, false);
    assert.deepEqual(drifted.audiences, ["researcher", "wizard"]);
  });
});
