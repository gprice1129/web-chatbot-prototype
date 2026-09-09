import { describe, it, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { read_secret } from "common";

// A name no real configuration uses, so the tests own it outright.
const NAME = "COMMON_SECRET_TEST";

describe("read_secret", () => {
  afterEach(() => {
    delete process.env[NAME];
    delete process.env[`${NAME}_FILE`];
  });

  it("reads the plain env var", () => {
    process.env[NAME] = "from-env";
    assert.equal(read_secret(NAME), "from-env");
  });

  it("reads the file NAME_FILE names, stripping the trailing newline", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "secret-"));
    try {
      const file = path.join(dir, "value");
      writeFileSync(file, "from-file\n");
      process.env[`${NAME}_FILE`] = file;
      assert.equal(read_secret(NAME), "from-file");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("prefers the plain env var when both are set", () => {
    process.env[NAME] = "from-env";
    process.env[`${NAME}_FILE`] = "/does/not/exist";
    assert.equal(read_secret(NAME), "from-env");
  });

  it("treats an empty env var as unset and falls through to the file", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "secret-"));
    try {
      const file = path.join(dir, "value");
      writeFileSync(file, "from-file");
      process.env[NAME] = "";
      process.env[`${NAME}_FILE`] = file;
      assert.equal(read_secret(NAME), "from-file");
    } finally {
      rmSync(dir, { recursive: true });
    }
  });

  it("answers undefined when neither is provided", () => {
    assert.equal(read_secret(NAME), undefined);
  });
});
