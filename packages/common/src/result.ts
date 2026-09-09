export {
  ok_or_throw,
}
export type { Result };

/*
 * Idea: The outcome of something that can fail, carried as a value.
 */
type Result<T, E = string> =
  | { ok: true;  value: T }
  | { ok: false; error: E };

/*
 * Idea: Captures the pattern of throwing on a failed result
 *
 * (Result<T>, string?) => T
 * Pure
 * Public
 */
function ok_or_throw<T>(read: Result<T>, context?: string): T {
  if (!read.ok) {
    if (undefined === context) throw new Error(read.error);
    throw new Error(`${context}: ${read.error}`);
  }
  return read.value;
}
