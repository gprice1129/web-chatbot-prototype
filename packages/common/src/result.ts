export type { Result };

/*
 * Idea: The outcome of something that can fail, carried as a value.
 */
type Result<T, E = string> =
  | { ok: true;  value: T }
  | { ok: false; error: E };
