export { make_pool };

import * as fs from "node:fs";
import * as pg from "pg";

// Resolve a secret from either NAME (a plaintext env var) or NAME_FILE (a path
// to a file holding the value, e.g. a Docker secret mounted at /run/secrets).
// The plaintext env var wins when both are set; a trailing newline in the file
// is stripped. Returns undefined when neither is provided.
function resolve_secret(name: string): string | undefined {
  const direct = process.env[name];
  if (undefined !== direct && "" !== direct) return direct;
  const file = process.env[`${name}_FILE`];
  if (file) return fs.readFileSync(file, "utf8").trim();
  return undefined;
}

// pg reads PGHOST/PGPORT/PGUSER/PGDATABASE from the environment directly;
// the password additionally supports the *_FILE secret convention. When no
// password is resolved, fall back to pg's own env handling (no change).
function make_pool(): pg.Pool {
  const password = resolve_secret("PGPASSWORD");
  return new pg.Pool(undefined !== password ? { password } : {});
}
