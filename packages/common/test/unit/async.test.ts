import { describe, it } from "node:test";
import * as assert from "node:assert/strict";
import { getEventListeners } from "node:events";

import { unless_aborted } from "common";

// A promise the test settles by hand.
function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  let reject: (err: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("unless_aborted", () => {
  it("settles as the promise does while the signal stays unaborted", async () => {
    const { signal } = new AbortController();
    assert.equal(await unless_aborted(Promise.resolve("done"), signal), "done");
    await assert.rejects(unless_aborted(Promise.reject(new Error("failed")), signal), /failed/);
  });

  it("rejects with the signal's reason once it aborts", async () => {
    const controller = new AbortController();
    const waited = unless_aborted(deferred<string>().promise, controller.signal);
    controller.abort();
    await assert.rejects(waited, { name: "AbortError" });
  });

  it("rejects at once on a signal already aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("gone"));
    await assert.rejects(unless_aborted(deferred<string>().promise, controller.signal), /gone/);
  });

  it("lets the pending work finish on its own after an abort", async () => {
    const controller = new AbortController();
    const work = deferred<string>();
    const waited = unless_aborted(work.promise, controller.signal);
    controller.abort();
    await assert.rejects(waited, { name: "AbortError" });
    work.resolve("late");
    assert.equal(await work.promise, "late");
  });

  it("leaves no listener on the signal once the promise settles", async () => {
    const { signal } = new AbortController();
    const work = deferred<string>();
    const waited = unless_aborted(work.promise, signal);
    assert.equal(getEventListeners(signal, "abort").length, 1);
    work.resolve("done");
    await waited;
    assert.equal(getEventListeners(signal, "abort").length, 0);
  });
});
