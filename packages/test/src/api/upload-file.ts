// Manual test for POST /files/upload.
//
// Logs in (default: testuser, which is auto-created when the server runs with
// APP_ENV=test) and uploads a single file.
//
// Usage:
//   node build/api/upload-file.js <path-to-file> [base-url]
//
// Env overrides:
//   USERNAME   login username (default: testuser)
//   PASSWORD   login password (default: irrelevant — the testing auth service
//              ignores it for the seeded user)

import * as fs from "node:fs";
import * as path from "node:path";
import { ApiClient, parse_args } from "#lib/client.js";

async function main(): Promise<void> {
  const [file_arg, ...rest] = process.argv.slice(2);
  if (!file_arg) {
    console.error("Usage: upload-file <path-to-file> [base-url]");
    process.exit(2);
  }
  if (!fs.existsSync(file_arg)) {
    console.error(`File not found: ${file_arg}`);
    process.exit(2);
  }

  const { base_url, username, password } = parse_args(rest);
  const client = new ApiClient(base_url);
  await client.login(username, password);

  const buf = await fs.promises.readFile(file_arg);
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(buf)]), path.basename(file_arg));

  console.log();
  console.log(`==> POST ${base_url}/api/files/upload  (file: ${file_arg})`);
  const res = await client.request("POST", "/api/files/upload", { body: form });
  if (res.status !== 200) process.exit(1);
}

await main();
