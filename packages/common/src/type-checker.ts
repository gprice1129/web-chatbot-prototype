export {
  is_object,
  is_string,
  is_number,
  is_boolean,
  is_missing,
}

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines runtime checks of what an unknown value is.
 */

/*
 * (unknown) => boolean
 * Whether a value can be read as a map of keyed values: an object that is
 * neither null nor an array.
 * Pure
 * Public
 */
function is_object(value: unknown): value is Record<string, unknown> {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}

/*
 * (unknown) => boolean
 * Whether a value is a string.
 * Pure
 * Public
 */
function is_string(value: unknown): value is string {
  return "string" === typeof value;
}

/*
 * (unknown) => boolean
 * Whether a value is a number by type. NaN and Infinity count, so finiteness
 * is the caller's concern.
 * Pure
 * Public
 */
function is_number(value: unknown): value is number {
  return "number" === typeof value;
}

/*
 * (unknown) => boolean
 * Whether a value is a boolean.
 * Pure
 * Public
 */
function is_boolean(value: unknown): value is boolean {
  return "boolean" === typeof value;
}

/*
 * (unknown) => boolean
 * Whether a value is absent: undefined or null. A present falsy value is not
 * missing.
 * Pure
 * Public
 */
function is_missing(value: unknown): value is undefined | null {
  return undefined === value || null === value;
}
