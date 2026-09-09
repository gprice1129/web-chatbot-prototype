export { make_pool };

import * as pg from "pg";
import { read_secret } from "common";

// pg reads PGHOST/PGPORT/PGUSER/PGDATABASE from the environment directly;
// the password additionally supports the *_FILE secret convention. When no
// password is resolved, fall back to pg's own env handling (no change).
function make_pool(): pg.Pool {
  const password = read_secret("PGPASSWORD");
  return new pg.Pool(undefined !== password ? { password } : {});
}
