import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { load_markdown_corpus } from "#kg/providers/markdown_corpus.js";
import { LexicalGraph } from "#kg/providers/lexical_graph.js";
import { KB_ROOT, KB_NODE_COUNT } from "../support/conformance.ts";

const nodes = await load_markdown_corpus(KB_ROOT, () => {});
const graph = new LexicalGraph(nodes);

// Ask for the whole corpus unless a test is about limiting.
const ALL = { limit: KB_NODE_COUNT };

describe("LexicalGraph host surface", () => {
  it("reports its size", () => {
    assert.equal(graph.size(), KB_NODE_COUNT);
    assert.equal(graph.nodes().length, KB_NODE_COUNT);
  });

  it("refuses two nodes sharing an id", () => {
    const [first] = nodes;
    assert.throws(
      () => new LexicalGraph([first, { ...first, title: "Impostor" }]),
      /duplicate node id/);
  });
});

describe("LexicalGraph get", () => {
  it("trims an id before looking it up", async () => {
    assert.equal((await graph.get("  whisper  "))?.id, "whisper");
  });

  it("reaches a name through punctuation differences, not just case", async () => {
    assert.equal((await graph.get("Speech-to-Text"))?.id, "whisper");
  });

  it("prefers a direct id over another node's matching name", async () => {
    const whisper = nodes.find((node) => "whisper" === node.id)!;
    const rival = { ...whisper, id: "rival", title: "whisper", aliases: [] };
    const test_graph = new LexicalGraph([rival, whisper]);
    assert.equal((await test_graph.get("whisper"))?.id, "whisper");
  });

  it("resolves a shared name to whichever node was loaded first", async () => {
    const [first] = nodes;
    const test_graph = new LexicalGraph([first, { ...first, id: "twin" }]);
    assert.equal((await test_graph.get(first.title))?.id, first.id);
  });

  it("resolves a deprecated node to itself, not to its successor", async () => {
    const node = await graph.get("retired-note-taker");
    assert.equal(node?.id, "retired-note-taker");
    assert.equal(node?.deprecated, true);
    assert.deepEqual(node?.edges["superseded_by"], ["whisper"]);
  });

  it("returns null for a name that normalizes to nothing", async () => {
    // "!!!" reduces to the empty string, which must not become a key that
    // accidentally answers.
    assert.equal(await graph.get("!!!"), null);
  });
});

describe("LexicalGraph scoring", () => {
  it("scores a match above zero and ranks the best first", () => {
    const hits = graph.search_scored("fabricated citations in a manuscript", ALL);
    assert.equal(hits[0].node.id, "hallucinated-citations");
    assert.ok(hits[0].score > 0);
  });

  it("gives an exact id a decisive bonus over accumulated overlap", () => {
    const hits = graph.search_scored("whisper", ALL);
    assert.equal(hits[0].node.id, "whisper");
    // The bonus is meant to be decisive, not merely to win on points.
    if (hits.length > 1) assert.ok(hits[0].score > hits[1].score * 2);
  });

  it("matches a term by prefix, so a partial word still reaches its node", () => {
    const hits = graph.search_scored("transcrib", ALL);
    assert.ok(hits.some((h) => "transcribing-audio" === h.node.id));
  });

  it("returns hits in descending score order", () => {
    const hits = graph.search_scored("transcription audio whisper", ALL);
    assert.ok(hits.length > 1, "expected the query to match several nodes");
    for (let i = 1; i < hits.length; i++) {
      assert.ok(hits[i - 1].score >= hits[i].score, "scores must not increase");
    }
  });

  it("scores nothing for a query of only stopwords", () => {
    assert.deepEqual(graph.search_scored("what is the", ALL), []);
  });

  it("search() is search_scored() with the scores dropped", async () => {
    const scored = graph.search_scored("transcription", ALL);
    const ranked = await graph.search("transcription", ALL);
    assert.ok(scored.length > 0, "expected the query to match");
    assert.deepEqual(ranked, scored.map((h) => h.node));
  });
});
