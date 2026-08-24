/*
 * The intended exposed interface for the common package
 */

export type {
  Result,
} from "#common/result.js";

export {
  separate_frontmatter,
  parse_frontmatter,
} from "#common/frontmatter.js";

export type {
  FrontmatterValue,
  FrontmatterMap,
} from "#common/frontmatter.js";

export {
  is_object,
  is_string,
  is_number,
  is_boolean,
  is_missing,
} from "#common/type-checker.js";
