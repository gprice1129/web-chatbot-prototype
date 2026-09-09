import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { parse_boolean, parse_positive_int } from "common";

describe("parse_boolean", () => {
  it("reads unset or blank as the fallback", () => {
    assert.equal(parse_boolean("DEBUG_MODE", undefined, false), false);
    assert.equal(parse_boolean("DEBUG_MODE", "  ", true), true);
  });

  it("reads true and false, ignoring surrounding whitespace", () => {
    assert.equal(parse_boolean("DEBUG_MODE", "true", false), true);
    assert.equal(parse_boolean("DEBUG_MODE", " false ", true), false);
  });

  it("refuses anything else, naming the variable", () => {
    assert.throws(
      () => parse_boolean("DEBUG_MODE", "yes", false),
      /DEBUG_MODE must be true or false, got "yes"/);
  });
});

describe("parse_positive_int", () => {
  it("reads a positive integer", () => {
    assert.equal(parse_positive_int("RATE_LIMIT_LOGIN_MAX", "5"), 5);
  });

  it("refuses unset or blank, naming the variable", () => {
    assert.throws(
      () => parse_positive_int("RATE_LIMIT_LOGIN_MAX", undefined),
      /RATE_LIMIT_LOGIN_MAX is required/);
    assert.throws(() => parse_positive_int("RATE_LIMIT_LOGIN_MAX", "  "),
      /RATE_LIMIT_LOGIN_MAX is required/);
  });

  it("refuses zero, negatives, fractions and text", () => {
    for (const raw of ["0", "-3", "1.5", "many"]) {
      assert.throws(
        () => parse_positive_int("RATE_LIMIT_LOGIN_MAX", raw),
        /RATE_LIMIT_LOGIN_MAX must be a positive integer/,
        `for "${raw}"`);
    }
  });
});
