export {
  start_job_queue,
}
export type {
  PgBoss,
}

import * as fs from "node:fs";
import PgBoss from "pg-boss";

// Resolve a secret from either NAME (a plaintext env var) or NAME_FILE (a path to a file holding the value)
function read_secret(name: string): string | undefined {
  const direct = process.env[name];
  if (undefined !== direct && "" !== direct) return direct;
  const file = process.env[`${name}_FILE`];
  if (file) return fs.readFileSync(file, "utf8").trim();
  return undefined;
}

// TODO:[jobs] guard pg-boss bootstrap with a postgres advisory lock so multiple
// processes do not race the schema migrations / queue creation. today the
// race is avoided externally: docker-compose gates `parser` on `app`'s
// healthcheck, which only goes green after the webserver finishes
// start_job_queue() + make_parse_queue(). that breaks down as soon as we run
// more than one webserver replica -- both replicas would race each other.
// the robust fix is to wrap boss.start() (and any createQueue calls) in
// `pg_advisory_lock(<constant>)` / `pg_advisory_unlock` so only one
// process at a time runs the bootstrap.
async function start_job_queue(): Promise<PgBoss> {
  // TODO:[jobs] add configuration
  const boss = new PgBoss({
    host: process.env["PGHOST"],
    port: process.env["PGPORT"] ? Number(process.env["PGPORT"]) : undefined,
    user: process.env["PGUSER"],
    password: read_secret("PGPASSWORD"),
    database: process.env["PGDATABASE"],
  });
  boss.on("error", (err: Error) => console.error("pg-boss error:", err));
  await boss.start();
  return boss;
}
