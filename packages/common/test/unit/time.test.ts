import { describe, it } from "node:test";
import * as assert from "node:assert/strict";

import { parse_iso_date } from "common";

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
