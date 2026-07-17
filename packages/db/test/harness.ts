export { make_test_pool, reset_db, test_db_config };

import * as child_process from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as pg from "pg";

// Compiled to test/build/harness.js, so the repo root is four directories up.
const repo_root = fileURLToPath(new URL("../../../..", import.meta.url));

// The compose file publishes no host port for postgres, so by default connect
// to the container's IP on the compose network. Override with TEST_PGHOST
// when postgres runs elsewhere.
function resolve_host(): string {
  const direct = process.env["TEST_PGHOST"];
  if (undefined !== direct && "" !== direct) return direct;
  const container = `${path.basename(repo_root)}-postgres-1`;
  const ip = child_process
    .execFileSync(
      "docker",
      ["inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", container],
      { encoding: "utf8" },
    )
    .trim();
  if ("" === ip) {
    throw new Error(`no IP address for container ${container}; is compose up?`);
  }
  return ip;
}

function read_secret(name: string): string {
  return fs.readFileSync(path.join(repo_root, "secrets", name), "utf8").trim();
}

// Connection settings for the scratch test database. Deliberately independent
// of the standard PG* variables so a shell configured for the real
// application database (e.g. via .env.local) can never point the tests at it.
const test_db_config = {
  host: resolve_host(),
  port: Number(process.env["TEST_PGPORT"] ?? "5432"),
  database: process.env["TEST_PGDATABASE"] ?? "aim_hi_test",
  app_user: process.env["TEST_PGUSER"] ?? "aim_hi_user",
  app_password: read_secret("app_db_password"),
  super_user: process.env["TEST_PGSUPERUSER"] ?? "postgres",
  super_password: read_secret("postgres_password"),
};

// Destructive operations (drop, truncate) are gated on these checks so a
// misconfiguration can never aim them at the real application database. The
// names are also interpolated into DDL, so restrict them to identifier-safe
// characters.
if (!/^[a-z_][a-z0-9_]*_test$/.test(test_db_config.database)) {
  throw new Error(`test database name must end in "_test", got: ${test_db_config.database}`);
}
if (!/^[a-z_][a-z0-9_]*$/.test(test_db_config.app_user)) {
  throw new Error(`unsafe app user name: ${test_db_config.app_user}`);
}

// Pool for tests, connected to the scratch database as the application role —
// the same privileges the services run with in production. Every field is
// explicit so ambient PG* variables cannot redirect it.
function make_test_pool(): pg.Pool {
  return new pg.Pool({
    host: test_db_config.host,
    port: test_db_config.port,
    user: test_db_config.app_user,
    password: test_db_config.app_password,
    database: test_db_config.database,
  });
}

// Wipe user data between tests. Truncating users cascades through every table
// that hangs off it (sessions, files, chats, projects, chat_memories, ...);
// the seeded applications rows are kept.
async function reset_db(pool: pg.Pool): Promise<void> {
  await pool.query("TRUNCATE users CASCADE");
}
