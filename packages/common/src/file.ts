export {
  read_text,
  find_files,
  list_files,
}
export type {
  FindOptions,
  FileTree,
}

import * as fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import * as path from "node:path";

import type { Result } from "#common/result.js";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines finding and reading files on the filesystem as things that
 * can fail, with the failure carried as a value rather than thrown.
 */

/*
 * Application Usage
 * -----------------------------------------------------------------------------
 * Content loaders find the files under a root, read each one, and decide what
 * a bad file costs. What is shared is the finding and the reading; the policy
 * is theirs.
 *
 * An error here says only what went wrong. The caller knows where, and says
 * so in the form it wants: relative to its root, or as the absolute path.
 */

/*
 * Idea: A file's text, or why it could not be read.
 *
 * (string) => Result<string>
 * Side Effect: reads the filesystem
 * Public
 */
async function read_text(file: string): Promise<Result<string>> {
  try {
    return { ok: true, value: await fs.readFile(file, "utf8") };
  } catch (err) {
    return { ok: false, error: `unreadable (${_reason(err)})` };
  }
}

/*
 * Idea: What to look for, and whether there must be anywhere to look.
 *
 * `optional` reads a missing directory as holding nothing.
 */
interface FindOptions {
  extension?: string;
  optional?: boolean;
}

/*
 * Idea: A directory as found: the files in it, and the directories in it as
 * trees of their own.
 *
 * Files are full paths, relative or absolute according to the directory they
 * were found from. Subtrees are keyed by directory name.
 */
interface FileTree {
  dir: string;
  files: string[];
  subtrees: Record<string, FileTree>;
}

/*
 * Idea: Everything under a directory, kept in the shape it was found in.
 *
 * (string, FindOptions?) => Result<FileTree>
 * Entries are visited in name order, so two readings of one directory agree.
 * Side Effect: reads the filesystem
 * Public
 */
async function find_files(
    dir: string, options: FindOptions = {}): Promise<Result<FileTree>> {
  const tree: FileTree = { dir, files: [], subtrees: {} };
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (true === options.optional && _is_missing(err)) return { ok: true, value: tree };
    return { ok: false, error: `unreadable (${_reason(err)})` };
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const below = await find_files(full, { extension: options.extension });
      if (!below.ok) return { ok: false, error: `${entry.name}: ${below.error}` };
      tree.subtrees[entry.name] = below.value;
    } else if (entry.isFile() && _has_extension(entry.name, options.extension)) {
      tree.files.push(full);
    }
  }
  return { ok: true, value: tree };
}

/*
 * Idea: A tree flattened to the files it holds, at any depth.
 *
 * (FileTree) => string[]
 * Sorted by path, so the order does not depend on how the tree was walked.
 * Pure
 * Public
 */
function list_files(tree: FileTree): string[] {
  const found = [...tree.files];
  for (const subtree of Object.values(tree.subtrees)) {
    found.push(...list_files(subtree));
  }
  return found.sort();
}

/*
 * Idea: Whether a name ends the way the caller asked for.
 *
 * (string, string | undefined) => boolean
 * Pure
 * Private
 */
function _has_extension(name: string, extension: string | undefined): boolean {
  return undefined === extension || name.endsWith(extension);
}

/*
 * Idea: Whether a filesystem error says the path does not exist.
 *
 * (unknown) => boolean
 * Pure
 * Private
 */
function _is_missing(err: unknown): boolean {
  return err instanceof Error && "ENOENT" === (err as NodeJS.ErrnoException).code;
}

/*
 * Idea: Whatever was thrown, as a sentence.
 *
 * (unknown) => string
 * Pure
 * Private
 */
function _reason(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
