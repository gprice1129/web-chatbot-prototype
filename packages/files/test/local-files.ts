// Unit tests for LocalFileService. Run with `npm test`.
//
// Each test gets its own temp directory so order doesn't matter and a leak
// in one test cannot mask a bug in another. No server, no DB.

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { LocalFileService } from "files";

let base_path: string;
let svc: LocalFileService;

beforeEach(async () => {
  base_path = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), "local-files-test-"));
  svc = new LocalFileService({ base_path });
});

afterEach(async () => {
  await fs.promises.rm(base_path, { recursive: true, force: true });
});

describe("LocalFileService.write", () => {
  it("returns size and sha256 of the written bytes", async () => {
    const input = Buffer.from("hello world");
    const expected_checksum = crypto.createHash("sha256")
      .update(input).digest("hex");

    const result = await svc.write(Readable.from(input));

    await assert_valid_storage_key(result.storage_key);
    assert.equal(result.size_bytes, input.length);
    assert.equal(result.checksum_sha256, expected_checksum);
  });

  it("handles a 1 MiB random buffer", async () => {
    const input = crypto.randomBytes(1024 * 1024);
    const expected_checksum = crypto.createHash("sha256")
      .update(input).digest("hex");

    const result = await svc.write(Readable.from(input));

    await assert_valid_storage_key(result.storage_key);
    assert.equal(result.size_bytes, input.length);
    assert.equal(result.checksum_sha256, expected_checksum);
  });

  it("allocates a unique storage_key per call", async () => {
    const a = await svc.write(Readable.from(Buffer.from("a")));
    const b = await svc.write(Readable.from(Buffer.from("b")));
    await assert_valid_storage_key(a.storage_key);
    await assert_valid_storage_key(b.storage_key);
    assert.notEqual(a.storage_key, b.storage_key);
  });

  it("cleans up the partial blob if the source stream errors", async () => {
    // A stream that pushes some bytes then aborts. The service should unlink
    // whatever it had partially written so the temp dir ends up empty.
    const failing = new Readable({
      read() {
        this.push(Buffer.from("partial"));
        this.destroy(new Error("boom"));
      },
    });

    await assert.rejects(svc.write(failing), /boom/);

    const leaked = await find_files(base_path);
    assert.deepEqual(leaked, [],
      `partial blob not cleaned up; leaked: ${JSON.stringify(leaked)}`);
  });
});

describe("LocalFileService.read", () => {
  it("streams back the exact bytes that were written", async () => {
    const input = crypto.randomBytes(64 * 1024);
    const { storage_key } = await svc.write(Readable.from(input));

    const stream = await svc.read(storage_key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const round_tripped = Buffer.concat(chunks);

    assert.ok(round_tripped.equals(input),
      "round-tripped bytes did not match input");
  });

  it("rejects when the storage_key does not exist", async () => {
    await assert.rejects(
      svc.read("00/00/00000000-0000-0000-0000-000000000000"),
      (err: NodeJS.ErrnoException) => err.code === "ENOENT");
  });

  it("rejects before returning a stream so headers are still safe to set",
      async () => {
    // The contract is: the returned promise rejects rather than us getting
    // back a stream that errors later. Routes rely on this to avoid setting
    // response headers and then failing mid-body.
    let stream_returned = false;
    try {
      await svc.read("00/00/00000000-0000-0000-0000-000000000000");
      stream_returned = true;
    } catch { /* expected */ }
    assert.equal(stream_returned, false);
  });
});

describe("LocalFileService.delete", () => {
  it("removes the file", async () => {
    const { storage_key } = await svc.write(Readable.from(Buffer.from("x")));
    // Sanity check: read works before delete.
    (await svc.read(storage_key)).destroy();

    await svc.delete(storage_key);

    await assert.rejects(svc.read(storage_key),
      (err: NodeJS.ErrnoException) => err.code === "ENOENT");
  });

  it("is a no-op for a missing storage_key", async () => {
    await svc.delete("00/00/00000000-0000-0000-0000-000000000000");
  });

  it("is idempotent across repeated calls", async () => {
    const { storage_key } = await svc.write(Readable.from(Buffer.from("x")));
    await svc.delete(storage_key);
    await svc.delete(storage_key);
  });
});

describe("LocalFileService.backend", () => {
  it("identifies as 'local' so rows can be routed back to it", () => {
    assert.equal(svc.backend, "local");
  });
});

// LocalFileService allocates storage_keys as `XX/YY/<uuid>`, where XX and YY
// are the first two byte-pairs of the uuid hex. The exact layout is internal
// but is contract-stable for the local backend, and routes persist the key
// to db.files.storage_key — so a regression here would corrupt rows.
async function assert_valid_storage_key(storage_key: string): Promise<void> {
  const STORAGE_KEY_PATTERN = /^[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  assert.match(storage_key, STORAGE_KEY_PATTERN,
    `storage_key ${JSON.stringify(storage_key)} did not match expected layout`);
  // Format alone is not enough — the key must also resolve to a real file
  // on disk, otherwise read/delete handed the key would fail.
  const stat = await fs.promises.stat(path.join(base_path, storage_key));
  assert.ok(stat.isFile(), `storage_key ${storage_key} does not resolve to a regular file`);
}

// Walk the temp dir and return every regular file it contains, relative to
// base_path. Used to assert that failed writes leave nothing behind.
async function find_files(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(p: string) {
    for (const entry of await fs.promises.readdir(p, { withFileTypes: true })) {
      const child = path.join(p, entry.name);
      if (entry.isDirectory()) await walk(child);
      else out.push(path.relative(dir, child));
    }
  }
  await walk(dir);
  return out;
}
