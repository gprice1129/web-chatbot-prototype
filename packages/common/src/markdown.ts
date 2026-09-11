export {
  read_markdown,
  find_markdown,
}
export type {
  MarkdownDocument,
}

import type { Result } from "#common/result.js";
import { read_text, find_files, type FindOptions } from "#common/file.js";
import {
  separate_frontmatter,
  parse_frontmatter,
  type FrontmatterMap,
} from "#common/frontmatter.js";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines a markdown document as content authored on the filesystem:
 * a frontmatter block describing the document, followed by its text.
 */

/*
 * Application Usage
 * -----------------------------------------------------------------------------
 * The knowledge base and the prompts are both directories of markdown
 * documents. 
 */

/*
 * Idea: A document that describes itself before it says anything.
 */
interface MarkdownDocument {
  fields: FrontmatterMap;
  body: string;
}

/*
 * Idea: A document's metadata and text, or why it could not be read.
 *
 * (string) => Result<MarkdownDocument>
 * A document with no frontmatter is refused.
 * Side Effect: reads the filesystem
 * Public
 */
async function read_markdown(file: string): Promise<Result<MarkdownDocument>> {
  const read = await read_text(file);
  if (!read.ok) return read;
  const { frontmatter, body } = separate_frontmatter(read.value);
  const parsed = parse_frontmatter(frontmatter);
  if (!parsed.ok) return parsed;
  return { ok: true, value: { fields: parsed.value, body } };
}

/*
 * Idea: The markdown documents under a directory, in a fixed order.
 *
 * (string, Omit<FindOptions, "extension">?) => Result<string[]>
 * Side Effect: reads the filesystem
 * Public
 */
async function find_markdown(
    dir: string, options: Omit<FindOptions, "extension"> = {}): Promise<Result<string[]>> {
  return find_files(dir, { ...options, extension: ".md" });
}
