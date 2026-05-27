export {
  type PgBoss,
  ParseFileWorker,
  ParseFileJob,
  run_PgBoss,
  make_parse_queue,
  register_parser,
  enqueue_parse_job,
}

import PgBoss from "pg-boss";

interface ParseFileJob {
  file_id: string;
  mime_type: string;
  storage_key: string;
}

type ParseFileWorker = (job: PgBoss.Job<ParseFileJob>[]) => Promise<void>;

// TODO:[jobs] this is just for file parsing. If we add more jobs later we should break this up
// TODO:[jobs] guard pg-boss bootstrap with a postgres advisory lock so multiple
// processes do not race the schema migrations / queue creation. today the
// race is avoided externally: docker-compose gates `parser` on `app`'s
// healthcheck, which only goes green after the webserver finishes
// run_PgBoss() + make_parse_queue(). that breaks down as soon as we run
// more than one webserver replica -- both replicas would race each other.
// the robust fix is to wrap boss.start() (and any createQueue calls) in
// `pg_advisory_lock(<constant>)` / `pg_advisory_unlock` so only one
// process at a time runs the bootstrap.
async function run_PgBoss(): Promise<PgBoss> {
  // TODO:[jobs] add configuration
  const boss = new PgBoss({
    host: process.env["PGHOST"],
    port: process.env["PGPORT"] ? Number(process.env["PGPORT"]) : undefined,
    user: process.env["PGUSER"],
    password: process.env["PGPASSWORD"],
    database: process.env["PGDATABASE"],
  });
  boss.on("error", (err: Error) => console.error("pg-boss error:", err));
  await boss.start();
  return boss;
}

async function make_parse_queue(boss: PgBoss): Promise<void> {
  return boss.createQueue(_QUEUE_PARSE_FILE);
}

async function register_parser(boss: PgBoss, worker: ParseFileWorker): Promise<void> {
  await boss.work<ParseFileJob>(_QUEUE_PARSE_FILE, worker);
}

async function enqueue_parse_job(boss: PgBoss, job: ParseFileJob): Promise<void> {
  await boss.send(_QUEUE_PARSE_FILE, job);
}

const _QUEUE_PARSE_FILE = "parse_file";
