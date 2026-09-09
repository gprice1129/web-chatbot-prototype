export {
  parse_boolean,
  parse_positive_int,
}

import type { Result } from "#common/result.js";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines how configuration text is read into typed values. The raw
 * string an environment variable held comes in; reading either yields a usable
 * value or a Result error. The caller decides whether a bad value stops
 * startup or falls back, and attaches which variable it was reading.
 */

/*
 * Idea: Read a true/false flag. Unset or blank means the fallback.
 *
 * (string | undefined, boolean) => Result<boolean>
 * Pure
 * Public
 */
function parse_boolean(raw: string | undefined, fallback: boolean): Result<boolean> {
  if (raw === undefined || raw.trim() === "") return { ok: true, value: fallback };
  const text = raw.trim();
  if (text === "true") return { ok: true, value: true };
  if (text === "false") return { ok: true, value: false };
  return { ok: false, error: `expected true or false, got "${raw}"` };
}

/*
 * Idea: Read a required positive integer.
 *
 * (string | undefined) => Result<number>
 * Pure
 * Public
 */
function parse_positive_int(raw: string | undefined): Result<number> {
  if (raw === undefined || raw.trim() === "") {
    return { ok: false, error: "expected a positive integer" };
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    return { ok: false, error: `expected a positive integer, got "${raw}"` };
  }
  return { ok: true, value: n };
}
