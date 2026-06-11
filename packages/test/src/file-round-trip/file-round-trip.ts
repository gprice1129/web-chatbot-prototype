// Standalone example/test for the full upload → status → download flow.
//
// Reading this file shows the complete file lifecycle:
//   1. POST /api/chats/:chat_id/files/upload         (multipart upload)
//   2. Poll GET /api/chats/:chat_id/files/status/... (until terminal)
//   3. GET  /api/chats/:chat_id/files/download/...   (stream to disk)
//
// Running it against a live server asserts that the round trip works
// end-to-end:
//
//   npm run file-round-trip -- <chat-id> <path-to-file> [base-url]
//
// The server must be running with APP_ENV=test, which seeds `testuser` and
// configures the testing auth service to ignore the password. <chat-id>
// must be a chat owned by `testuser` — typically obtained from
// `npm run chat-create`.

import * as fs from "node:fs";
import * as path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface RoundTripOptions {
  base_url: string;
  chat_id: string;
  file_path: string;
  username: string;
  password: string;
  // Where to write the downloaded bytes. Same semantics as file-download:
  // a directory → server-supplied filename appended; a path → used as the
  // literal target; undefined → server-supplied filename in the cwd.
  output: string | undefined;
  poll_interval_ms: number;
  poll_timeout_ms: number;
}

interface DownloadResult {
  output_path: string;
  bytes: number;
  mime_type: string;
}

interface RoundTripResult {
  id: string;
  status: string;
  download: DownloadResult;
}

// `queued` is the only non-terminal status — the parser will eventually
// flip it to `parsed` or `parse_failed`. `uploaded` means the file is not
// parsable, so its bytes are the final artifact and no parse step runs.
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "uploaded", "parsed", "parse_failed",
]);

export async function file_round_trip(
    opts: RoundTripOptions): Promise<RoundTripResult> {
  // 1. Login. The response sets a signed `session` cookie that all gated
  //    routes require. Doing this once lets us reuse the cookie for the
  //    upload, every status poll, and the download.
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

  // Pre-encode the chat segment once — it's reused across all three calls.
  const chat_path = `/api/chats/${encodeURIComponent(opts.chat_id)}`;

  // 2. Upload. multipart/form-data with a single `file` part. The server
  //    sniffs the MIME type from the bytes; the filename is preserved as
  //    the file's display name. Response carries the new file's id and
  //    its initial status (`queued` if parsable, `uploaded` otherwise).
  const buf = await fs.promises.readFile(opts.file_path);
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(buf)]),
    path.basename(opts.file_path));
  const upload_res = await fetch(
    `${opts.base_url}${chat_path}/files/upload`,
    { method: "POST", headers: { Cookie: session_cookie }, body: form });
  const upload_body = await upload_res.text();
  if (upload_res.status !== 200) {
    throw new Error(
      `Upload failed (HTTP ${upload_res.status}): ${upload_body}`);
  }
  const { id, status: initial_status } =
    JSON.parse(upload_body) as { id: string; status: string };

  // 3. Poll status until terminal. We sleep first then read so a fast
  //    parser doesn't get hammered, and we cap total wait time so a
  //    stuck job surfaces as a timeout error rather than an infinite loop.
  let status = initial_status;
  if (!TERMINAL_STATUSES.has(status)) {
    const deadline = Date.now() + opts.poll_timeout_ms;
    while (true) {
      if (Date.now() >= deadline) {
        throw new Error(
          `Status polling timed out after ${opts.poll_timeout_ms}ms `
          + `(last status: ${status})`);
      }
      await new Promise((r) => setTimeout(r, opts.poll_interval_ms));
      const status_res = await fetch(
        `${opts.base_url}${chat_path}/files/status/${encodeURIComponent(id)}`,
        { method: "GET", headers: { Cookie: session_cookie } });
      const status_body = await status_res.text();
      if (status_res.status !== 200) {
        throw new Error(
          `Status fetch failed (HTTP ${status_res.status}): ${status_body}`);
      }
      ({ status } = JSON.parse(status_body) as { id: string; status: string });
      if (TERMINAL_STATUSES.has(status)) break;
    }
  }
  if (status === "parse_failed") {
    throw new Error(`File parse failed for id ${id}`);
  }

  // 4. Download. Streams the original bytes back with the original mime
  //    type and a content-disposition that carries the original filename.
  //    Same as file-download: prefer the RFC 5987 filename* form so
  //    non-ASCII names round-trip cleanly.
  const dl_res = await fetch(
    `${opts.base_url}${chat_path}/files/download/${encodeURIComponent(id)}`,
    { method: "GET", headers: { Cookie: session_cookie } });
  if (dl_res.status !== 200) {
    throw new Error(
      `Download failed (HTTP ${dl_res.status}): ${await dl_res.text()}`);
  }
  if (!dl_res.body) throw new Error("Download response had no body");

  const filename = parse_disposition_filename(
    dl_res.headers.get("content-disposition")) ?? id;
  const output_path = resolve_output_path(opts.output, filename);

  // Stream straight to disk — large files should not need to materialize in
  // memory. Web streams from undici interop with Node writable streams via
  // Readable.fromWeb.
  await pipeline(
    Readable.fromWeb(dl_res.body as Parameters<typeof Readable.fromWeb>[0]),
    fs.createWriteStream(output_path));

  const stat = await fs.promises.stat(output_path);
  return {
    id,
    status,
    download: {
      output_path,
      bytes: stat.size,
      mime_type: dl_res.headers.get("content-type") ?? "",
    },
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

// CLI driver — when run via `npm run file-round-trip`, exercise the function
// against a live server and print the response. Throws on any failure, which
// surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const chat_id = process.argv[2];
  const file_path = process.argv[3];
  if (!chat_id || !file_path) {
    console.error(
      "Usage: file-round-trip <chat-id> <path-to-file> [base-url]");
    process.exit(2);
  }
  const result = await file_round_trip({
    base_url: process.argv[4] ?? "http://localhost:8080",
    chat_id,
    file_path,
    username: process.env.USERNAME ?? "testuser",
    password: process.env.PASSWORD ?? "irrelevant",
    output: process.env.OUTPUT,
    poll_interval_ms: Number(process.env.POLL_INTERVAL_MS ?? 1000),
    poll_timeout_ms: Number(process.env.POLL_TIMEOUT_MS ?? 60000),
  });
  console.log(JSON.stringify(result, null, 2));
}
