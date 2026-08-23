export {
  separate_frontmatter,
  parse_frontmatter,
  _has_non_ascii,
  _has_content,
  _is_field_map,
  _fault_of,
}
export type {
  FrontmatterValue,
  FrontmatterMap,
}

import { load, CORE_SCHEMA, YAMLException } from "js-yaml";

import type { Result } from "#common/result.js";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines handling frontmatter metadata blocks.
 */

/*
 * Application Usage
 * -----------------------------------------------------------------------------
 * The YAML is js-yaml's, not ours. A hand-written subset was tried and kept
 * finding, one construct at a time, that the rules it was reimplementing were
 * already written down somewhere better. What is left here is the part js-yaml
 * does not do: cutting the block off the body, holding the corpus to ASCII, and
 * answering with a Result rather than an exception.
 */

/*
 * (string) => { frontmatter: string, body: string }
 * Separate the frontmatter metadata from the content body.
 * Pure
 * Public
 */
function separate_frontmatter(text: string): { frontmatter: string; body: string } {
  const normalized = text.replace(/\r\n/g, "\n");
  const opener = /^---[ \t]*\n/.exec(normalized);
  if (null === opener) return { frontmatter: "", body: normalized };
  const start = opener[0].length;
  const end = normalized.indexOf("\n---", start - 1);
  if (-1 === end) return { frontmatter: "", body: normalized };
  const after = normalized.indexOf("\n", end + 1);
  return {
    frontmatter: normalized.slice(start, end + 1),
    body: -1 === after ? "" : normalized.slice(after + 1),
  };
}

/*
 * (string) => Result<FrontmatterMap>
 * Read a metadata block into fields.
 *
 * A block declaring nothing or fails parsing is refused.
 * Pure
 * Public
 */
function parse_frontmatter(frontmatter: string): Result<FrontmatterMap> {
  if (_has_non_ascii(frontmatter)) {
    return { ok: false, error: "frontmatter: expected ASCII text" };
  }
  if (!_has_content(frontmatter)) {
    return { ok: false, error: "frontmatter: expected at least one `key: value` field" };
  }
  let loaded: unknown;
  try {
    loaded = load(frontmatter, { schema: CORE_SCHEMA });
  } catch (err) {
    if (!(err instanceof YAMLException)) throw err;
    return { ok: false, error: _fault_of(err) };
  }
  if (!_is_field_map(loaded)) {
    return { ok: false, error: "frontmatter: expected a block of `key: value` fields" };
  }
  return { ok: true, value: loaded };
}

interface FrontmatterMap { [key: string]: FrontmatterValue }
type FrontmatterValue =
  string | number | boolean | null | FrontmatterValue[] | FrontmatterMap;

/*
 * (string) => boolean
 * Whether a block holds anything outside ASCII.
 * Pure
 * Private
 */
function _has_non_ascii(frontmatter: string): boolean {
  for (const character of frontmatter) {
    if (character.charCodeAt(0) > 127) return true;
  }
  return false;
}

/*
 * (string) => boolean
 * Whether a block has at least one line that is neither blank nor a comment.
 * Pure
 * Private
 */
function _has_content(frontmatter: string): boolean {
  return frontmatter.split("\n").some((line) => {
    const trimmed = line.trim();
    return "" !== trimmed && !trimmed.startsWith("#");
  });
}

/*
 * (unknown) => boolean
 * Whether what was parsed is a block of fields rather than something else.
 * Pure
 * Private
 */
function _is_field_map(value: unknown): value is FrontmatterMap {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}

/*
 * (YAMLException) => string
 * Restate a parser error in the one shape every refusal here uses.
 * Pure
 * Private
 */
function _fault_of(err: YAMLException): string {
  if (undefined === err.mark) return `frontmatter: ${err.reason}`;
  return `frontmatter line ${err.mark.line + 1}: ${err.reason}`;
}
