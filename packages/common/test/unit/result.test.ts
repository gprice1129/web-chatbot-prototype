import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { ok_or_throw, map_ok, map_error, type Result } from "common";

describe("ok_or_throw", () => {
  it("hands back the value of a success", () => {
    const read: Result<number> = { ok: true, value: 8 };
    assert.equal(ok_or_throw(read), 8);
  });

  it("throws the error of a failure", () => {
    const read: Result<number> = { ok: false, error: "expected a positive integer" };
    assert.throws(() => ok_or_throw(read), /^Error: expected a positive integer$/);
  });

  it("prefixes the thrown error with the context", () => {
    const read: Result<number> = { ok: false, error: "expected a positive integer" };
    assert.throws(
      () => ok_or_throw(read, "LOGIN_BODY_LIMIT"),
      /LOGIN_BODY_LIMIT: expected a positive integer/);
  });

  it("ignores the context on a success", () => {
    const read: Result<number> = { ok: true, value: 8 };
    assert.equal(ok_or_throw(read, "LOGIN_BODY_LIMIT"), 8);
  });
});

describe("map_ok", () => {
  it("transforms the value of a success", () => {
    const read: Result<number> = { ok: true, value: 8 };
    assert.deepEqual(map_ok(read, (n) => String(n)), { ok: true, value: "8" });
  });

  it("passes a failure through untouched", () => {
    const read: Result<number> = { ok: false, error: "expected a positive integer" };
    assert.deepEqual(map_ok(read, (n) => String(n)), read);
  });
});

describe("map_error", () => {
  it("transforms the error of a failure", () => {
    const read: Result<number> = { ok: false, error: "expected a positive integer" };
    assert.deepEqual(
      map_error(read, (e) => `LOGIN_BODY_LIMIT: ${e}`),
      { ok: false, error: "LOGIN_BODY_LIMIT: expected a positive integer" });
  });

  it("passes a success through untouched", () => {
    const read: Result<number> = { ok: true, value: 8 };
    assert.deepEqual(map_error(read, (e) => `LOGIN_BODY_LIMIT: ${e}`), read);
  });
});
