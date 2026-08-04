// setup_db.ts
//
// Recreates the scratch test database on the compose postgres instance, then
// applies every migration and seed file in filename order. Run automatically
// with `npm test`.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as pg from "pg";
import { test_db_config } from "./harness.js";

const repo_root = fileURLToPath(new URL("../../../..", import.meta.url));

async function run_sql_dir(client: pg.Client, dir: string): Promise<void> {
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    console.log(`  applying ${f}`);
    await client.query(fs.readFileSync(path.join(dir, f), "utf8"));
  }
}

const { host, port, database, app_user } = test_db_config;

// Drop and recreate as the superuser. The app role owns the fresh database.
console.log(`Recreating ${database} on ${host}:${port}`);
const admin = new pg.Client({
  host,
  port,
  user: test_db_config.super_user,
  password: test_db_config.super_password,
  database: "postgres",
});
await admin.connect();
await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${database} OWNER ${app_user}`);
await admin.end();

// Extensions the migrations depend on.
const ext = new pg.Client({
  host,
  port,
  user: test_db_config.super_user,
  password: test_db_config.super_password,
  database,
});
await ext.connect();
await ext.query("CREATE EXTENSION IF NOT EXISTS vector");
await ext.end();

// Run the migrations and seed.
const client = new pg.Client({
  host,
  port,
  user: app_user,
  password: test_db_config.app_password,
  database,
});
await client.connect();
await run_sql_dir(client, path.join(repo_root, "config", "db", "migrations"));
await run_sql_dir(client, path.join(repo_root, "config", "db", "seed"));
await client.end();
console.log("Test database ready.");
