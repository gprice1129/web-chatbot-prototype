export {
  parse_boolean,
  parse_positive_int,
}

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines how configuration text is read into typed values. The raw
 * string an environment variable held comes in; reading either yields a usable
 * value or throws an error naming the variable.
 */

/*
 * Idea: Read a true/false flag. Unset or blank means the fallback.
 *
 * (string, string | undefined, boolean) => boolean
 * Pure
 * Public
 */
function parse_boolean(name: string, raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const text = raw.trim();
  if (text === "true") return true;
  if (text === "false") return false;
  throw new Error(`${name} must be true or false, got "${raw}"`);
}

/*
 * Idea: Read a required positive integer.
 *
 * (string, string | undefined) => number
 * Pure
 * Public
 */
function parse_positive_int(name: string, raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    throw new Error(`${name} is required`);
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return n;
}
