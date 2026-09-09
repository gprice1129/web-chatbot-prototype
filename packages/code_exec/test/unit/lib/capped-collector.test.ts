import { test } from "node:test";
import assert from "node:assert/strict";
import { CappedCollector } from "#lib/capped-collector.js";

test("collects chunks below the cap", () => {
  const collector = new CappedCollector(16);
  collector.push(Buffer.from("hello "));
  collector.push(Buffer.from("world"));
  assert.equal(collector.text(), "hello world");
  assert.equal(collector.truncated, false);
});

test("filling the cap exactly is not truncation", () => {
  const collector = new CappedCollector(4);
  collector.push(Buffer.from("abcd"));
  assert.equal(collector.text(), "abcd");
  assert.equal(collector.truncated, false);
});

test("keeps the first cap bytes of an oversized chunk", () => {
  const collector = new CappedCollector(4);
  collector.push(Buffer.from("abcdef"));
  assert.equal(collector.text(), "abcd");
  assert.equal(collector.truncated, true);
});

test("drops all chunks after truncation", () => {
  const collector = new CappedCollector(4);
  collector.push(Buffer.from("abcdef"));
  collector.push(Buffer.from("ghij"));
  assert.equal(collector.text(), "abcd");
  assert.equal(collector.truncated, true);
});

test("rejects a non-positive or fractional cap", () => {
  assert.throws(() => new CappedCollector(0));
  assert.throws(() => new CappedCollector(-1));
  assert.throws(() => new CappedCollector(1.5));
});
