// Manual test for GET /files/status/:file_id.
//
// Logs in (default: testuser, which is auto-created when the server runs with
// APP_ENV=test) and fetches the parse status for a single file.
//
// Usage:
//   node build/api/file-status.js <file-id> [base-url]
//
// Env overrides:
//   USERNAME   login username (default: testuser)
//   PASSWORD   login password (default: irrelevant — the testing auth service
//              ignores it for the seeded user)

import { ApiClient, parse_args } from "#lib/client.js";

async function main(): Promise<void> {
  const [file_id, ...rest] = process.argv.slice(2);
  if (!file_id) {
    console.error("Usage: file-status <file-id> [base-url]");
    process.exit(2);
  }

  const { base_url, username, password } = parse_args(rest);
  const client = new ApiClient(base_url);
  await client.login(username, password);

  console.log();
  console.log(`==> GET ${base_url}/api/files/status/${file_id}`);
  const res = await client.request(
    "GET", `/api/files/status/${encodeURIComponent(file_id)}`);
  if (res.status !== 200) process.exit(1);
}

await main();
