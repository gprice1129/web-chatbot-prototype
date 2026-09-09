import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { parse_boolean, parse_positive_int } from "common";

describe("parse_boolean", () => {
  it("reads unset or blank as the fallback", () => {
    assert.deepEqual(parse_boolean(undefined, false), { ok: true, value: false });
    assert.deepEqual(parse_boolean("  ", true), { ok: true, value: true });
  });

  it("reads true and false, ignoring surrounding whitespace", () => {
    assert.deepEqual(parse_boolean("true", false), { ok: true, value: true });
    assert.deepEqual(parse_boolean(" false ", true), { ok: true, value: false });
  });

  it("fails on anything else, quoting what it got", () => {
    const read = parse_boolean("yes", false);
    assert.equal(read.ok, false);
    assert.match(read.ok ? "" : read.error, /expected true or false, got "yes"/);
  });
});

describe("parse_positive_int", () => {
  it("reads a positive integer", () => {
    assert.deepEqual(parse_positive_int("5"), { ok: true, value: 5 });
  });

  it("fails on unset or blank", () => {
    for (const raw of [undefined, "  "]) {
      const read = parse_positive_int(raw);
      assert.equal(read.ok, false, `for ${JSON.stringify(raw)}`);
      assert.match(read.ok ? "" : read.error, /expected a positive integer/);
    }
  });

  it("fails on zero, negatives, fractions and text, quoting what it got", () => {
    for (const raw of ["0", "-3", "1.5", "many"]) {
      const read = parse_positive_int(raw);
      assert.equal(read.ok, false, `for "${raw}"`);
      assert.match(
        read.ok ? "" : read.error,
        new RegExp(`expected a positive integer, got "${raw}"`),
        `for "${raw}"`);
    }
  });
});
