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
