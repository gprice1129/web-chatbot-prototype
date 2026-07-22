export {
  make_parse_queue,
  register_parser,
  enqueue_parse_job,
}
export type {
  ParseFileJob,
  ParseFileWorker,
}

import type PgBoss from "pg-boss";

interface ParseFileJob {
  file_id: string;
  mime_type: string;
  storage_key: string;
}

type ParseFileWorker = (job: PgBoss.Job<ParseFileJob>[]) => Promise<void>;

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
