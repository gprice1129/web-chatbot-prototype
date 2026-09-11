import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { read_markdown, find_markdown, list_files } from "common";

// Materialize `files` under a fresh temp directory, run the test, clean up.
async function with_tree(
  files: Record<string, string>,
  run: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), "markdown-"));
  try {
    for (const [rel, text] of Object.entries(files)) {
      const file = path.join(dir, rel);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, text);
    }
    await run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const MISSING = path.join(tmpdir(), "markdown-does-not-exist");

describe("read_markdown", () => {
  it("separates the fields from the body", async () => {
    await with_tree({ "doc.md": "---\nid: one\n---\nBody.\n" }, async (dir) => {
      const read = await read_markdown(path.join(dir, "doc.md"));
      assert.deepEqual(read, { ok: true, value: { fields: { id: "one" }, body: "Body.\n" } });
    });
  });

  it("refuses a document with no frontmatter", async () => {
    await with_tree({ "doc.md": "Just text.\n" }, async (dir) => {
      const read = await read_markdown(path.join(dir, "doc.md"));
      assert.equal(read.ok, false);
      if (read.ok) return;
      assert.match(read.error, /^frontmatter/);
    });
  });

  it("says why a document could not be read", async () => {
    const read = await read_markdown(path.join(MISSING, "doc.md"));
    assert.equal(read.ok, false);
    if (read.ok) return;
    assert.match(read.error, /^unreadable \(/);
  });
});

describe("find_markdown", () => {
  it("keeps only markdown documents, in the shape they were found in", async () => {
    await with_tree({ "a.md": "", "notes.txt": "", "sub/b.md": "" }, async (dir) => {
      const found = await find_markdown(dir);
      assert.ok(found.ok);
      assert.deepEqual(found.value.files, [path.join(dir, "a.md")]);
      assert.deepEqual(Object.keys(found.value.subtrees), ["sub"]);
      assert.deepEqual(list_files(found.value), [
        path.join(dir, "a.md"), path.join(dir, "sub", "b.md"),
      ]);
    });
  });

  it("reads a missing directory as empty when it is optional", async () => {
    const found = await find_markdown(MISSING, { optional: true });
    assert.deepEqual(found, { ok: true, value: { dir: MISSING, files: [], subtrees: {} } });
  });
});
