import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import {
  is_object,
  is_string,
  is_number,
  is_boolean,
  is_missing,
} from "common";

describe("is_object", () => {
  it("accepts a map of keyed values", () => {
    assert.equal(is_object({}), true);
    assert.equal(is_object({ q: "hi" }), true);
  });

  it("refuses everything else that typeof calls an object", () => {
    assert.equal(is_object(null), false);
    assert.equal(is_object([]), false);
    assert.equal(is_object(["a"]), false);
  });

  it("refuses non-objects", () => {
    assert.equal(is_object(undefined), false);
    assert.equal(is_object("q=hi"), false);
    assert.equal(is_object(7), false);
    assert.equal(is_object(true), false);
  });
});

describe("is_string", () => {
  it("accepts a string, empty included", () => {
    assert.equal(is_string(""), true);
    assert.equal(is_string("q"), true);
  });

  it("refuses non-strings", () => {
    assert.equal(is_string(7), false);
    assert.equal(is_string(["q"]), false);
    assert.equal(is_string(null), false);
    assert.equal(is_string(undefined), false);
  });
});

describe("is_number", () => {
  it("accepts a number by type, finite or not", () => {
    assert.equal(is_number(7), true);
    assert.equal(is_number(-1.5), true);
    assert.equal(is_number(NaN), true);
    assert.equal(is_number(Infinity), true);
  });

  it("refuses non-numbers", () => {
    assert.equal(is_number("7"), false);
    assert.equal(is_number(null), false);
    assert.equal(is_number(undefined), false);
  });
});

describe("is_boolean", () => {
  it("accepts both booleans", () => {
    assert.equal(is_boolean(true), true);
    assert.equal(is_boolean(false), true);
  });

  it("refuses non-booleans", () => {
    assert.equal(is_boolean("true"), false);
    assert.equal(is_boolean(0), false);
    assert.equal(is_boolean(null), false);
  });
});

describe("is_missing", () => {
  it("accepts the absent values", () => {
    assert.equal(is_missing(undefined), true);
    assert.equal(is_missing(null), true);
  });

  it("refuses present falsy values", () => {
    assert.equal(is_missing(""), false);
    assert.equal(is_missing(0), false);
    assert.equal(is_missing(false), false);
    assert.equal(is_missing(NaN), false);
  });
});
