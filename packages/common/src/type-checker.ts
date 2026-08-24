export {
  is_object,
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
