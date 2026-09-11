import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { read_text, find_files } from "common";

// Materialize `files` under a fresh temp directory, run the test, clean up.
async function with_tree(
  files: Record<string, string>,
  run: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), "file-"));
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

const MISSING = path.join(tmpdir(), "file-does-not-exist");

describe("read_text", () => {
  it("returns the file's text unchanged", async () => {
    await with_tree({ "doc.md": "  text\n\n" }, async (dir) => {
      const read = await read_text(path.join(dir, "doc.md"));
      assert.deepEqual(read, { ok: true, value: "  text\n\n" });
    });
  });

  it("says why a file could not be read", async () => {
    const read = await read_text(path.join(MISSING, "doc.md"));
    assert.equal(read.ok, false);
    if (read.ok) return;
    assert.match(read.error, /^unreadable \(/);
  });
});

describe("find_files", () => {
  const TREE = {
    "b.md": "",
    "a.md": "",
    "notes.txt": "",
    "sub/c.md": "",
  };

  it("lists the files in one directory, sorted", async () => {
    await with_tree(TREE, async (dir) => {
      const found = await find_files(dir);
      assert.deepEqual(found, {
        ok: true,
        value: ["a.md", "b.md", "notes.txt"].map((name) => path.join(dir, name)),
      });
    });
  });

  it("keeps only files with the asked-for extension", async () => {
    await with_tree(TREE, async (dir) => {
      const found = await find_files(dir, { extension: ".md" });
      assert.deepEqual(found, {
        ok: true,
        value: ["a.md", "b.md"].map((name) => path.join(dir, name)),
      });
    });
  });

  it("descends into subdirectories when asked", async () => {
    await with_tree(TREE, async (dir) => {
      const found = await find_files(dir, { extension: ".md", recursive: true });
      assert.deepEqual(found, {
        ok: true,
        value: ["a.md", "b.md", "sub/c.md"].map((name) => path.join(dir, name)),
      });
    });
  });

  it("refuses a missing directory", async () => {
    const found = await find_files(MISSING);
    assert.equal(found.ok, false);
    if (found.ok) return;
    assert.match(found.error, /^unreadable \(/);
  });

  it("reads a missing directory as empty when it is optional", async () => {
    const found = await find_files(MISSING, { optional: true });
    assert.deepEqual(found, { ok: true, value: [] });
  });
});
