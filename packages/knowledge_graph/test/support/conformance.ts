export {
  KB_ROOT,
  KB_NODE_COUNT,
  describe_knowledge_graph_source,
}

import { describe, it, before } from "node:test";
import * as assert from "node:assert/strict";
import * as path from "node:path";

import type { GraphNode } from "#kg/ontology.js";
import type { SearchFilters, KnowledgeGraphSource } from "#kg/port.js";

const KB_ROOT = path.join(import.meta.dirname, "..", "fixtures", "kb");
const KB_NODE_COUNT = 7;
const ALL: SearchFilters = { limit: KB_NODE_COUNT };

/*
 * (string, () => Promise<KnowledgeGraphSource>) => void
 * Register the conformance suite against one provider.
 * Side Effect: declares tests on the enclosing node:test runner
 * Public
 */
function describe_knowledge_graph_source(
    label: string,
    make_source: () => Promise<KnowledgeGraphSource>): void {
  describe(`KnowledgeGraphSource conformance: ${label}`, () => {
    let source: KnowledgeGraphSource;
    before(async () => { source = await make_source(); });

    describe("get", () => {
      it("resolves by id", async () => {
        assert.equal((await source.get("whisper"))?.id, "whisper");
      });

      it("resolves by exact title, case-insensitively", async () => {
        assert.equal((await source.get("Whisper"))?.id, "whisper");
      });

      it("resolves by alias", async () => {
        assert.equal((await source.get("speech to text"))?.id, "whisper");
      });

      it("returns null for an unknown id rather than throwing", async () => {
        assert.equal(await source.get("no-such-node"), null);
      });

      it("returns a whole ontology node", async () => {
        const node = await source.get("hallucinated-citations");
        assert.ok(null !== node);
        _assert_ontology_shape(node);
        assert.equal(node.title, "Fabricated citations");
        assert.equal(node.type, "risk");
        assert.equal(node.level, "foundational");
        assert.equal(node.draft, false);
        assert.equal(node.deprecated, false);
        assert.deepEqual(node.edges["parent"], ["m03-evaluating-ai-output"]);
        assert.deepEqual(node.edges["governed_by"], ["phi-and-hipaa-in-ai-tools"]);
        assert.ok(node.body.length > 0);
      });
    });

    describe("search", () => {
      it("puts an exact id first", async () => {
        const hits = await source.search("whisper", ALL);
        assert.equal(hits[0].id, "whisper");
      });

      it("finds a node through an alias rather than its title", async () => {
        assert.equal((await source.search("fake references", ALL))[0].id, "hallucinated-citations");
        assert.equal((await source.search("hipaa policy", ALL))[0].id, "phi-and-hipaa-in-ai-tools");
      });

      it("ranks a relevant node first for a natural-language query", async () => {
        const hits = await source.search("fabricated citations in a manuscript", ALL);
        assert.equal(hits[0].id, "hallucinated-citations");
      });

      it("returns nothing when no term matches", async () => {
        assert.deepEqual(await source.search("quantum chromodynamics", ALL), []);
      });

      it("returns whole ontology nodes", async () => {
        for (const node of await source.search("transcription", ALL)) {
          _assert_ontology_shape(node);
        }
      });

      it("filters by type", async () => {
        const policies = await source.search("patient data", { ...ALL, types: ["policy"] });
        assert.ok(policies.length > 0);
        assert.ok(policies.every((n) => "policy" === n.type));
      });

      it("filters by level", async () => {
        const applied = await source.search("transcription", { ...ALL, levels: ["applied"] });
        assert.ok(applied.every((n) => "applied" === n.level));
      });

      it("filters by audience", async () => {
        const developer = await source.search("transcription", { ...ALL, audiences: ["developer"] });
        assert.ok(developer.every((n) => n.audiences.includes("developer")));
      });

      it("treats an empty filter list as no constraint", async () => {
        const unfiltered = await source.search("transcription", ALL);
        const empty = await source.search("transcription", { ...ALL, types: [] });
        assert.deepEqual(empty.map((n) => n.id), unfiltered.map((n) => n.id));
      });

      it("excludes deprecated nodes unless asked for them", async () => {
        const query = "retired note taker";
        const found = await source.search(query, ALL);
        assert.equal(found.some((n) => "retired-note-taker" === n.id), false);

        const with_deprecated = await source.search(query, { ...ALL, include_deprecated: true });
        assert.equal(with_deprecated.some((n) => "retired-note-taker" === n.id), true);
      });

      it("honours the limit", async () => {
        assert.equal((await source.search("transcription", { limit: 1 })).length, 1);
      });

      it("never returns more than the corpus, whatever the limit", async () => {
        const wide = await source.search("transcription", { limit: 500 });
        assert.ok(wide.length <= KB_NODE_COUNT);
      });

      it("is stable: the same query twice gives the same order", async () => {
        const first = await source.search("transcription audio", ALL);
        const second = await source.search("transcription audio", ALL);
        assert.deepEqual(first.map((n) => n.id), second.map((n) => n.id));
      });
    });
  });
}

/*
 * (GraphNode) => void
 * Every field the tools project must be present and of the right kind. A
 * provider returning partial nodes would otherwise fail only later, inside
 * whichever tool happened to read the missing field.
 * Pure
 * Private
 */
function _assert_ontology_shape(node: GraphNode): void {
  assert.equal(typeof node.id, "string", "id");
  assert.equal(typeof node.title, "string", "title");
  assert.equal(typeof node.summary, "string", "summary");
  assert.equal(typeof node.type, "string", "type");
  assert.ok(null === node.level || "string" === typeof node.level, "level");
  assert.equal(typeof node.draft, "boolean", "draft");
  assert.equal(typeof node.deprecated, "boolean", "deprecated");
  assert.ok(Array.isArray(node.audiences), "audiences");
  assert.ok(Array.isArray(node.aliases), "aliases");
  assert.equal(typeof node.body, "string", "body");
  assert.ok(null !== node.edges && "object" === typeof node.edges, "edges");
  for (const targets of Object.values(node.edges)) {
    assert.ok(Array.isArray(targets), "edges values must be arrays");
  }
}
