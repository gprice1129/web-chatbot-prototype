import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

/*
 * These tests are for documenting the intended interface. 
 */

describe("the common package interface", () => {
  it("offers exactly what the barrel exports", async () => {
    const surface = Object.keys(await import("common")).sort();
    assert.deepEqual(surface, [
      "find_files",
      "find_markdown",
      "is_boolean",
      "is_missing",
      "is_number",
      "is_object",
      "is_string",
      "list_files",
      "map_error",
      "map_ok",
      "ok_or_throw",
      "parse_boolean",
      "parse_frontmatter",
      "parse_positive_int",
      "read_markdown",
      "read_secret",
      "read_text",
      "separate_frontmatter",
    ]);
  });

  it("refuses a module inside the package, reached by name", async () => {
    await assert.rejects(
      () => import("common/frontmatter.js"),
      (err: NodeJS.ErrnoException) => "ERR_PACKAGE_PATH_NOT_EXPORTED" === err.code);
  });

  it("refuses the build directory, reached by name", async () => {
    await assert.rejects(
      () => import("common/build/frontmatter.js"),
      (err: NodeJS.ErrnoException) => "ERR_PACKAGE_PATH_NOT_EXPORTED" === err.code);
  });

  it("keeps the underscored productions out of the barrel", async () => {
    const surface = Object.keys(await import("common"));
    assert.deepEqual(surface.filter((name) => name.startsWith("_")), []);
  });
});
