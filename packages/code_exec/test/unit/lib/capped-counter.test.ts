import { test } from "node:test";
import assert from "node:assert/strict";
import { CappedCounter } from "#lib/capped-counter.js";

test("increments up to the cap and then fails", () => {
  const counter = new CappedCounter(2);
  assert.equal(counter.try_increment(), true);
  assert.equal(counter.try_increment(), true);
  assert.equal(counter.try_increment(), false);
});

test("decrement makes room under the cap again", () => {
  const counter = new CappedCounter(1);
  assert.equal(counter.try_increment(), true);
  assert.equal(counter.try_increment(), false);
  counter.decrement();
  assert.equal(counter.try_increment(), true);
});

test("rejects a non-positive or fractional cap", () => {
  assert.throws(() => new CappedCounter(0));
  assert.throws(() => new CappedCounter(-1));
  assert.throws(() => new CappedCounter(1.5));
});

test("decrement below zero throws", () => {
  const counter = new CappedCounter(1);
  assert.throws(() => counter.decrement());
  assert.equal(counter.try_increment(), true);
  counter.decrement();
  assert.throws(() => counter.decrement());
});
