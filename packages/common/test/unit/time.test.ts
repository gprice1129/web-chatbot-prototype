import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { parse_iso_date, parse_duration_ms } from "common";

describe("parse_iso_date", () => {
  it("reads a date in the one accepted shape as UTC midnight", () => {
    assert.equal(parse_iso_date("2026-08-06")?.toISOString(), "2026-08-06T00:00:00.000Z");
  });

  it("refuses a day past the end of its month rather than rolling it forward", () => {
    assert.equal(parse_iso_date("2026-02-30"), null);
  });

  it("refuses a month that does not exist", () => {
    assert.equal(parse_iso_date("2026-13-01"), null);
  });

  it("refuses every other shape the Date built-in would accept", () => {
    for (const text of ["2026-8-6", "August 6, 2026", "2026-08-06T10:00", "20260806", ""]) {
      assert.equal(parse_iso_date(text), null, JSON.stringify(text));
    }
  });

  it("refuses what is not text", () => {
    for (const value of [undefined, null, 20260806, true]) {
      assert.equal(parse_iso_date(value), null, String(value));
    }
  });
});

describe("parse_duration_ms", () => {
  it("reads a count and a unit as milliseconds", () => {
    assert.deepEqual(parse_duration_ms("15 seconds"), { ok: true, value: 15_000 });
    assert.deepEqual(parse_duration_ms("1 hour"), { ok: true, value: 3_600_000 });
    assert.deepEqual(parse_duration_ms("2 days"), { ok: true, value: 172_800_000 });
  });

  it("accepts a bare count as milliseconds", () => {
    assert.deepEqual(parse_duration_ms("250"), { ok: true, value: 250 });
  });

  it("ignores surrounding whitespace, the space before the unit, and its case", () => {
    assert.deepEqual(parse_duration_ms(" 30s "), { ok: true, value: 30_000 });
    assert.deepEqual(parse_duration_ms("5 Minutes"), { ok: true, value: 300_000 });
  });

  it("fails on unset or blank", () => {
    for (const raw of [undefined, "  "]) {
      const read = parse_duration_ms(raw);
      assert.equal(read.ok, false, `for ${JSON.stringify(raw)}`);
      assert.equal(read.ok ? "" : read.error, "expected a duration");
    }
  });

  it("fails on a missing count, an unknown unit, or a fraction, quoting what it got", () => {
    for (const raw of ["seconds", "10 fortnights", "1.5 hours", "-5 s"]) {
      const read = parse_duration_ms(raw);
      assert.equal(read.ok, false, `for "${raw}"`);
      assert.equal(read.ok ? "" : read.error, `expected a duration, got "${raw}"`);
    }
  });
});
