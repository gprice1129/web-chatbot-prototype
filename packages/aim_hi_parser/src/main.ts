import * as fs from "node:fs";
import {
  run_PgBoss,
  make_parse_queue,
  register_parser,
  ParseFileJob,
} from "aim_hi_jobs";
import { parse_file } from "#lib/parser.js";

async function main(): Promise<void> {
  const boss = await run_PgBoss();
  await make_parse_queue(boss);
  await register_parser(boss, async (jobs: ParseFileJob[]) => {
    // TODO:[jobs] error handling for parse or write failure
    for (const job of jobs) {
      const { file_id, mime_type, file_path } = job.data;
      console.log(`[${job.id}] parsing ${file_id} (${mime_type})`);
      const text = await parse_file(file_path, mime_type);
      const parsed_path = `${file_path}_parsed.txt`;
      await fs.promises.writeFile(parsed_path, text, "utf-8");
      console.log(`[${job.id}] wrote ${parsed_path}`);
    }
  });

  console.log("worker ready");

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.on(sig, async () => {
      console.log(`received ${sig}, shutting down`);
      await boss.stop();
      process.exit(0);
    });
  }
}

await main();
