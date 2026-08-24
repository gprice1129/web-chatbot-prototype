import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { is_object } from "common";

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
