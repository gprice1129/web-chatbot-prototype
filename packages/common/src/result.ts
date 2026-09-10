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
 * (Result<T, E>, string?) => T
 * Pure
 * Public
 */
function ok_or_throw<T, E>(read: Result<T, E>, context?: string): T {
  if (!read.ok) {
    const message = _render_error(read.error);
    if (undefined === context) throw new Error(message);
    throw new Error(`${context}: ${message}`);
  }
  return read.value;
}

/*
 * Idea: A string error already is the message; anything else is serialized.
 *
 * (unknown) => string
 * Pure
 * Private
 */
function _render_error(error: unknown): string {
  if (typeof error === "string") return error;
  return JSON.stringify(error) ?? String(error);
}
