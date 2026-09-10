import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { ok_or_throw, type Result } from "common";

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

  it("serializes a structured error", () => {
    const read: Result<number, { kind: string; message: string }> =
      { ok: false, error: { kind: "docker_error", message: "no such image" } };
    assert.throws(
      () => ok_or_throw(read),
      /{"kind":"docker_error","message":"no such image"}/);
  });

  it("prefixes a structured error with the context", () => {
    const read: Result<number, { kind: string }> =
      { ok: false, error: { kind: "spawn_failure" } };
    assert.throws(
      () => ok_or_throw(read, "runner"),
      /runner: {"kind":"spawn_failure"}/);
  });
});
