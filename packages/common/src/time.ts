export {
  parse_iso_date,
  parse_duration_ms,
}

import type { Result } from "#common/result.js";

// Milliseconds per unit a duration may be written in.
const _UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1000, sec: 1000, secs: 1000, second: 1000, seconds: 1000,
  m: 60_000, min: 60_000, mins: 60_000, minute: 60_000, minutes: 60_000,
  h: 3_600_000, hr: 3_600_000, hour: 3_600_000, hours: 3_600_000,
  d: 86_400_000, day: 86_400_000, days: 86_400_000,
};

/*
 * Idea: Read a calendar date written as YYYY-MM-DD, and nothing else.
 *
 * (unknown) => Date | null
 * The text is read as a UTC midnight and written back out; only text that
 * survives the round trip unchanged was a real date in the one accepted shape.
 * Pure
 * Public
 */
function parse_iso_date(value: unknown): Date | null {
  const text = String(value);
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  if (date.toISOString().slice(0, 10) !== text) return null;
  return date;
}

/*
 * Idea: Read a duration written as a count and a unit, such as "15 seconds"
 * or "1 hour", as milliseconds. A bare count is already milliseconds.
 *
 * (string | undefined) => Result<number>
 * The count is the run of digits the text starts with; whatever follows,
 * less surrounding whitespace, is the unit. Unset or blank is an error, as
 * a required setting's is.
 * Pure
 * Public
 */
function parse_duration_ms(raw: string | undefined): Result<number> {
  if (raw === undefined || raw.trim() === "") {
    return { ok: false, error: "expected a duration" };
  }
  const text = raw.trim();
  const digits = _leading_digits(text);
  const unit = text.slice(digits.length).trim().toLowerCase();
  const unit_ms = "" === unit ? 1 : _UNIT_MS[unit];
  if (0 === digits.length || undefined === unit_ms) {
    return { ok: false, error: `expected a duration, got "${raw}"` };
  }
  return { ok: true, value: Number(digits) * unit_ms };
}

/*
 * (string) => string
 * The digits the text starts with, possibly none.
 * Pure
 * Private
 */
function _leading_digits(text: string): string {
  let end = 0;
  while (end < text.length && text[end] >= "0" && text[end] <= "9") end++;
  return text.slice(0, end);
}
