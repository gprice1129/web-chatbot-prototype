export {
  read_secret,
}

import * as fs from "node:fs";

/*
 * Main Concept
 * -----------------------------------------------------------------------------
 * This file defines how a secret reaches the process: as the plain NAME env
 * var, or as NAME_FILE naming a file that holds the value, e.g. a Docker
 * secret mounted at /run/secrets.
 */

/*
 * Idea: Resolve a secret from NAME or NAME_FILE.
 *
 * The plaintext env var wins when both are set; a trailing newline in the file
 * is stripped. Undefined when neither is provided, so the caller decides
 * whether the secret is required.
 *
 * (string) => string | undefined
 * Side Effect: reads the environment and the filesystem
 * Public
 */
function read_secret(name: string): string | undefined {
  const direct = process.env[name];
  if (undefined !== direct && "" !== direct) return direct;
  const file = process.env[`${name}_FILE`];
  if (file) return fs.readFileSync(file, "utf8").trim();
  return undefined;
}
