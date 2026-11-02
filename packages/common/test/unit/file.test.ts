import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { read_text, find_files, list_files } from "common";

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
    "sub/deeper/d.md": "",
  };

  it("keeps the directory shape, with files in name order", async () => {
    await with_tree(TREE, async (dir) => {
      const found = await find_files(dir);
      const sub = path.join(dir, "sub");
      const deeper = path.join(sub, "deeper");
      assert.deepEqual(found, {
        ok: true,
        value: {
          dir,
          files: ["a.md", "b.md", "notes.txt"].map((name) => path.join(dir, name)),
          subtrees: {
            sub: {
              dir: sub,
              files: [path.join(sub, "c.md")],
              subtrees: {
                deeper: { dir: deeper, files: [path.join(deeper, "d.md")], subtrees: {} },
              },
            },
          },
        },
      });
    });
  });

  it("keeps only files with the asked-for extension, at every depth", async () => {
    await with_tree(TREE, async (dir) => {
      const found = await find_files(dir, { extension: ".md" });
      assert.ok(found.ok);
      assert.deepEqual(list_files(found.value), [
        "a.md", "b.md", "sub/c.md", "sub/deeper/d.md",
      ].map((name) => path.join(dir, name)));
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
    assert.deepEqual(found, { ok: true, value: { dir: MISSING, files: [], subtrees: {} } });
  });
});

describe("list_files", () => {
  it("flattens a tree to its files sorted by path", () => {
    const tree = {
      dir: "r",
      files: ["r/z.md", "r/a.md"],
      subtrees: { m: { dir: "r/m", files: ["r/m/b.md"], subtrees: {} } },
    };
    assert.deepEqual(list_files(tree), ["r/a.md", "r/m/b.md", "r/z.md"]);
  });
});
