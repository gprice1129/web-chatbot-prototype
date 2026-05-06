import * as fs from "node:fs";
import DatabaseService, { FileStatus } from "aim_hi_db";
import {
  type PgBoss,
  run_PgBoss,
  register_parser,
  ParseFileJob,
} from "aim_hi_jobs";
import { parse_file } from "#lib/parser.js";

async function main(): Promise<void> {
  const db = new DatabaseService();
  const boss = await run_PgBoss();
  await register_parser(boss, async (jobs: PgBoss.Job<ParseFileJob>[]) => {
    for (const job of jobs) {
      const { file_id, mime_type, file_path } = job.data;
      console.log(`[${job.id}] parsing ${file_id} (${mime_type})`);
      try {
        const text = await parse_file(file_path, mime_type);
        const parsed_path = `${file_path}_parsed.txt`;
        await fs.promises.writeFile(parsed_path, text, "utf-8");
        await db.update_file_status(file_id, FileStatus.PARSED);
        console.log(`[${job.id}] wrote ${parsed_path}`);
      } catch (err) {
        // TODO:[parser] on failure we may have left a partial `_parsed.txt`
        // on disk. unlink it so a stale file doesn't get treated as success
        // by downstream consumers.
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

await main();
