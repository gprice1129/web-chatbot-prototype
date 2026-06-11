// Standalone example/test for GET /api/chats/:chat_id/files/download/:file_id.
//
// Reading this file shows the full download protocol (authenticate, then GET
// the file id under a chat the user owns and stream the bytes to disk).
// Running it against a live server asserts that the route works end-to-end:
//
//   npm run file-download -- <chat-id> <file-id> [base-url]
//
// The server must be running with APP_ENV=test, which seeds `testuser` and
// configures the testing auth service to ignore the password. <chat-id> must
// be a chat owned by `testuser` — typically obtained from `npm run chat-create`.

import * as fs from "node:fs";
import * as path from "node:path";

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface DownloadOptions {
  base_url: string;
  chat_id: string;
  file_id: string;
  username: string;
  password: string;
  // Where to write the downloaded bytes. If a directory, the server-provided
  // filename (from content-disposition) is appended. If undefined, the
  // server-provided filename is written to the current working directory.
  output: string | undefined;
}

interface DownloadResult {
  output_path: string;
  bytes: number;
  mime_type: string;
}

export async function file_download(
    opts: DownloadOptions): Promise<DownloadResult> {
  // 1. Login. The response sets a signed `session` cookie that gated routes
  //    (including /files/download) require on subsequent requests.
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

  // 2. Download. The route streams the original bytes back with the original
  //    mime type and a content-disposition that carries the original
  //    filename. A chat_id the user does not own — or a file_id the user
  //    does not own — returns 404 to avoid leaking existence across users.
  const dl_res = await fetch(
    `${opts.base_url}/api/chats/${encodeURIComponent(opts.chat_id)}`
      + `/files/download/${encodeURIComponent(opts.file_id)}`,
    { method: "GET", headers: { Cookie: session_cookie } });
  if (dl_res.status !== 200) {
    throw new Error(
      `Download failed (HTTP ${dl_res.status}): ${await dl_res.text()}`);
  }
  if (!dl_res.body) throw new Error("Download response had no body");

  const filename = parse_disposition_filename(
    dl_res.headers.get("content-disposition")) ?? opts.file_id;
  const output_path = resolve_output_path(opts.output, filename);

  // Stream straight to disk — large files should not need to materialize in
  // memory. Web streams from undici interop with Node writable streams via
  // Readable.fromWeb.
  const { Readable } = await import("node:stream");
  const { pipeline } = await import("node:stream/promises");
  await pipeline(
    Readable.fromWeb(dl_res.body as Parameters<typeof Readable.fromWeb>[0]),
    fs.createWriteStream(output_path));

  const stat = await fs.promises.stat(output_path);
  return {
    output_path,
    bytes: stat.size,
    mime_type: dl_res.headers.get("content-type") ?? "",
  };
}

// content-disposition is set as:
//   attachment; filename="<raw>"; filename*=UTF-8''<percent-encoded>
// Prefer the RFC 5987 filename* form when present — it round-trips non-ASCII
// names cleanly.
function parse_disposition_filename(header: string | null): string | undefined {
  if (!header) return undefined;
  const star = header.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (star) {
    try { return decodeURIComponent(star[1]!); } catch { /* fall through */ }
  }
  const plain = header.match(/filename\s*=\s*"([^"]+)"/i);
  return plain?.[1];
}

function resolve_output_path(
    output: string | undefined, server_filename: string): string {
  if (!output) return path.resolve(server_filename);
  // If `output` exists and is a directory, drop the server filename inside it.
  // Otherwise treat it as the literal target path.
  try {
    if (fs.statSync(output).isDirectory()) {
      return path.resolve(output, server_filename);
    }
  } catch { /* output does not exist — treat as target path */ }
  return path.resolve(output);
}

// CLI driver — when run via `npm run file-download`, exercise the function
// against a live server and print the response. Throws on any failure, which
// surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const chat_id = process.argv[2];
  const file_id = process.argv[3];
  if (!chat_id || !file_id) {
    console.error("Usage: file-download <chat-id> <file-id> [base-url]");
    process.exit(2);
  }
  const result = await file_download({
    base_url: process.argv[4] ?? "http://localhost:8080",
    chat_id,
    file_id,
    username: process.env.USERNAME ?? "testuser",
    password: process.env.PASSWORD ?? "irrelevant",
    output: process.env.OUTPUT,
  });
  console.log(JSON.stringify(result, null, 2));
}
