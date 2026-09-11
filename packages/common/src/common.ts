/*
 * The intended exposed interface for the common package
 */

export type {
  Result,
} from "#common/result.js";

export {
  ok_or_throw,
  map_ok,
  map_error,
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

export {
  parse_boolean,
  parse_positive_int,
} from "#common/env.js";

export {
  read_secret,
} from "#common/secret.js";

export {
  read_text,
  find_files,
  list_files,
} from "#common/file.js";

export type {
  FindOptions,
  FileTree,
} from "#common/file.js";

export {
  read_markdown,
  find_markdown,
} from "#common/markdown.js";

export type {
  MarkdownDocument,
} from "#common/markdown.js";
