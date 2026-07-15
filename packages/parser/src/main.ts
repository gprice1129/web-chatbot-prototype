import { Readable } from "node:stream";
import { buffer } from "node:stream/consumers";
import DatabaseService, { FileStatus } from "db";
import {
  type PgBoss,
  start_job_queue,
  register_parser,
  ParseFileJob,
} from "job_queue";
import { LocalFileService } from "file_storage";
import { parse_file } from "#lib/parser.js";

async function main(): Promise<void> {
  const db = new DatabaseService();
  const boss = await start_job_queue();
  const file_service = new LocalFileService({
    base_path: required_env("FILES_BASE_PATH"),
  });
  await register_parser(boss, async (jobs: PgBoss.Job<ParseFileJob>[]) => {
    for (const job of jobs) {
      const { file_id, mime_type, storage_key } = job.data;
      console.log(`[${job.id}] parsing ${file_id} (${mime_type})`);
      const parsed_storage_key = `${storage_key}_parsed.txt`;
      try {
        const input = await file_service.read(storage_key);
        const buf = await buffer(input);
        const text = await parse_file(buf, mime_type);
        await file_service.write(Readable.from(Buffer.from(text, "utf-8")),
          parsed_storage_key);
        await db.update_file_status(file_id, FileStatus.PARSED);
        console.log(`[${job.id}] wrote ${parsed_storage_key}`);
      } catch (err) {
        // Drop any partial parsed blob so a stale file is not treated as
        // success by downstream consumers.
        await file_service.delete(parsed_storage_key).catch(() => {});
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[${job.id}] parse failed for ${file_id}: ${msg}`);
        await db.update_file_status(file_id, FileStatus.PARSE_FAILED, msg);
      }
    }
  });

  console.log("worker ready");

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, async () => {
      console.log(`received ${sig}, shutting down`);
      await boss.stop();
      await db.close();
      process.exit(0);
    });
  }
}

function required_env(name: string): string {
  const val = process.env[name];
  if (undefined === val || "" === val) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val;
}

await main();
