// Standalone example/test for POST /api/chats/:chat_id/files/upload.
//
// Reading this file shows the full upload protocol (authenticate, then post a
// multipart `file` part scoped to a chat the user owns). Running it against
// a live server asserts that the route works end-to-end:
//
//   npm run file-upload -- <chat-id> <path-to-file> [base-url]
//
// The server must be running with APP_ENV=test, which seeds `testuser` and
// configures the testing auth service to ignore the password. <chat-id> must
// be a chat owned by `testuser` — typically obtained from `npm run chat-create`.

import * as fs from "node:fs";
import * as path from "node:path";

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface FileUploadOptions {
  base_url: string;
  chat_id: string;
  file_path: string;
  username: string;
  password: string;
}

interface FileUploadResult {
  id: string;
  status: string;
}

export async function file_upload(
    opts: FileUploadOptions): Promise<FileUploadResult> {
  // 1. Login. The response sets a signed `session` cookie that gated routes
  //    (including /files/upload) require on subsequent requests.
  const login_res = await fetch(`${opts.base_url}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: opts.username, password: opts.password }),
  });
  if (login_res.status !== 200) {
    throw new Error(
      `Login failed (HTTP ${login_res.status}): ${await login_res.text()}`);
  }

  // getSetCookie() preserves multiple Set-Cookie headers individually; .get()
  // would flatten them with commas and corrupt the values.
  const session_cookie = login_res.headers.getSetCookie()
    .map((sc) => sc.split(";", 1)[0]!)
    .find((c) => c.startsWith("session="));
  if (!session_cookie) throw new Error("Login response had no session cookie");

  // 2. Upload. The route expects multipart/form-data with a single `file`
  //    part. The server sniffs the MIME type from the bytes; the filename is
  //    preserved as the file's display name. The chat_id in the path is
  //    validated by the chat-validate hook — a chat the user does not own
  //    returns 404 before the upload runs.
  const buf = await fs.promises.readFile(opts.file_path);
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(buf)]),
    path.basename(opts.file_path));

  const upload_res = await fetch(
    `${opts.base_url}/api/chats/${encodeURIComponent(opts.chat_id)}/files/upload`,
    {
      method: "POST",
      headers: { Cookie: session_cookie },
      body: form,
    });
  const body = await upload_res.text();
  if (upload_res.status !== 200) {
    throw new Error(`Upload failed (HTTP ${upload_res.status}): ${body}`);
  }
  return JSON.parse(body) as FileUploadResult;
}

// CLI driver — when run via `npm run file-upload`, exercise the function
// against a live server and print the response. Throws on any failure, which
// surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const chat_id = process.argv[2];
  const file_path = process.argv[3];
  if (!chat_id || !file_path) {
    console.error("Usage: file-upload <chat-id> <path-to-file> [base-url]");
    process.exit(2);
  }
  const result = await file_upload({
    base_url: process.argv[4] ?? "https://localhost",
    chat_id,
    file_path,
    username: process.env.USERNAME ?? "testuser",
    password: process.env.PASSWORD ?? "irrelevant",
  });
  console.log(JSON.stringify(result, null, 2));
}
