export {
  ok_or_throw,
  map_ok,
  map_error,
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

/*
 * Idea: Captures the pattern of transforming a success and passing a failure
 * through untouched.
 *
 * (Result<T, E>, (T) => U) => Result<U, E>
 * Pure
 * Public
 */
function map_ok<T, U, E>(read: Result<T, E>, transform: (value: T) => U): Result<U, E> {
  if (!read.ok) return read;
  return { ok: true, value: transform(read.value) };
}

/*
 * Idea: Captures the pattern of transforming a failure and passing a success
 * through untouched.
 *
 * (Result<T, E>, (E) => F) => Result<T, F>
 * Pure
 * Public
 */
function map_error<T, E, F>(read: Result<T, E>, transform: (error: E) => F): Result<T, F> {
  if (read.ok) return read;
  return { ok: false, error: transform(read.error) };
}
