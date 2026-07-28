// Standalone example/test for the full grant review flow.
//
// Reading this file shows the end-to-end protocol from raw documents to a
// generated grant review:
//   1. POST /api/chats                                (create the chat)
//   2. POST /api/chats/:chat_id/files/upload          (rfa, metadata.role=rfa)
//   3. POST /api/chats/:chat_id/files/upload          (companion file —
//                                                      metadata.role=proposal,
//                                                      or `aims` for mode=aims)
//   4. Poll GET /api/chats/:chat_id/files/status/...  (until both terminal)
//   5. POST /api/applications/grant_review            (run the review)
//
// Running it against a live server asserts that the full flow works end to
// end:
//
//   npm run grant-review-full -- <rfa-path> <companion-path> [mode] [base-url]
//
// `companion-path` is the proposal document for the default modes, or the
// specific-aims document when `mode=aims`. The server must be running with
// APP_ENV=test, which seeds `testuser` and configures the testing auth
// service to ignore the password.
//
// Progress is reported through the optional `on_progress` callback so the
// library version can be embedded in other tests silently while the CLI
// driver streams stage updates to stderr (final JSON stays on stdout).

import * as fs from "node:fs";
import * as path from "node:path";

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Declare the multipart part's Content-Type from the file extension. The server
// sniffs binary types (pdf/docx) from the bytes, but cannot sniff plain text: a
// .txt/.md upload is accepted on its declared type, or — when the client has no
// mapping for the extension and declares application/octet-stream — on the
// filename. Unknown extensions declare nothing and rely on sniffing.
function content_type_for(file_path: string): string {
  switch (path.extname(file_path).toLowerCase()) {
    case ".txt": return "text/plain";
    case ".md":
    case ".markdown": return "text/markdown";
    case ".pdf": return "application/pdf";
    case ".docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    default: return "";
  }
}

interface GrantReviewFullOptions {
  base_url: string;
  rfa_path: string;
  companion_path: string;
  mode: string;
  title: string;
  username: string;
  password: string;
  poll_interval_ms: number;
  poll_timeout_ms: number;
  on_progress?: (msg: string) => void;
}

interface UploadedFile {
  id: string;
  status: string;
}

interface GrantReviewFullResult {
  chat_id: string;
  rfa: UploadedFile;
  companion: UploadedFile;
  review: { message: string[] };
}

// `queued` is the only non-terminal status — the parser will eventually flip
// it to `parsed` or `parse_failed`. `uploaded` means the file was not
// parsable, so its raw bytes are the final artifact.
const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "uploaded", "parsed", "parse_failed",
]);

export async function grant_review_full(
    opts: GrantReviewFullOptions): Promise<GrantReviewFullResult> {
  const progress = opts.on_progress ?? (() => {});
  const started_at = Date.now();
  const log = (msg: string) => {
    const elapsed = ((Date.now() - started_at) / 1000).toFixed(1);
    progress(`[+${elapsed}s] ${msg}`);
  };

  // 1. Login. The response sets a signed `session` cookie that every gated
  //    route in this flow requires. Reuse the cookie across all calls so we
  //    pay the login round-trip only once.
  log("logging in...");
  const login_res = await fetch(`${opts.base_url}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: opts.username, password: opts.password }),
  });
  if (login_res.status !== 200) {
    throw new Error(
      `Login failed (HTTP ${login_res.status}): ${await login_res.text()}`);
  }
  const session_cookie = login_res.headers.getSetCookie()
    .map((sc) => sc.split(";", 1)[0]!)
    .find((c) => c.startsWith("session="));
  if (!session_cookie) throw new Error("Login response had no session cookie");

  // 2. Create the chat. The handler returns `{ id, title }` for the new chat;
  //    we keep the id for the rest of the flow.
  log(`creating chat (title=${JSON.stringify(opts.title)})...`);
  const create_res = await fetch(`${opts.base_url}/api/chats`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: session_cookie,
    },
    body: JSON.stringify({ title: opts.title }),
  });
  const create_body = await create_res.text();
  if (create_res.status !== 200) {
    throw new Error(
      `Chat create failed (HTTP ${create_res.status}): ${create_body}`);
  }
  const { id: chat_id } = JSON.parse(create_body) as { id: string };
  const chat_path = `/api/chats/${encodeURIComponent(chat_id)}`;
  log(`chat created (id=${chat_id})`);

  // 3. Upload the two documents. Multipart fields alongside the `file` part
  //    are persisted as string-valued metadata on the file row — the grant
  //    review handler looks files up by `metadata.role`. Companion role
  //    depends on the mode: `aims` for AIMS, `proposal` for every other mode.
  const companion_role = opts.mode === "aims" ? "aims" : "proposal";
  log(`uploading rfa from ${opts.rfa_path}...`);
  log(`uploading ${companion_role} from ${opts.companion_path}...`);
  const [rfa, companion] = await Promise.all([
    upload(opts.base_url, session_cookie, chat_path, opts.rfa_path,
      { role: "rfa" }).then(r => {
        log(`rfa uploaded (id=${r.id}, status=${r.status})`);
        return r;
      }),
    upload(opts.base_url, session_cookie, chat_path, opts.companion_path,
      { role: companion_role }).then(r => {
        log(`${companion_role} uploaded (id=${r.id}, status=${r.status})`);
        return r;
      }),
  ]);

  // 4. Wait for both files to reach a terminal status. Parsable mimes (pdf,
  //    docx, …) come back as `queued` and the parser flips them to `parsed`
  //    asynchronously; non-parsable mimes (e.g. text/plain) start at
  //    `uploaded` and need no polling. Bail out on `parse_failed` — the
  //    review handler would otherwise return 400 with a "not ready" error.
  log("waiting for files to reach a terminal status...");
  const [rfa_final, companion_final] = await Promise.all([
    wait_until_terminal(opts.base_url, session_cookie, chat_path,
      rfa, opts.poll_interval_ms, opts.poll_timeout_ms,
      s => log(`rfa: ${s}`)),
    wait_until_terminal(opts.base_url, session_cookie, chat_path,
      companion, opts.poll_interval_ms, opts.poll_timeout_ms,
      s => log(`${companion_role}: ${s}`)),
  ]);
  if (rfa_final.status === "parse_failed") {
    throw new Error(`rfa parse failed for id ${rfa_final.id}`);
  }
  if (companion_final.status === "parse_failed") {
    throw new Error(
      `${companion_role} parse failed for id ${companion_final.id}`);
  }

  // 5. Run the review. The handler resolves the rfa and companion files by
  //    `metadata.role`, reads each file's text content (parsed text for
  //    parsed files, raw bytes for plain-text uploads), generates the
  //    review, and records it as an ASSISTANT message on the chat.
  log(`running grant review (mode=${opts.mode})...`);
  const review_res = await fetch(
    `${opts.base_url}/api/applications/grant_review`
      + `?mode=${encodeURIComponent(opts.mode)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: session_cookie,
      },
      body: JSON.stringify({ chat_id }),
    });
  const review_body = await review_res.text();
  if (review_res.status !== 200) {
    throw new Error(
      `Grant review failed (HTTP ${review_res.status}): ${review_body}`);
  }
  const review = JSON.parse(review_body) as { message: string[] };
  log(`review complete (${review.message.length} block(s))`);

  return { chat_id, rfa: rfa_final, companion: companion_final, review };
}

async function upload(
    base_url: string,
    session_cookie: string,
    chat_path: string,
    file_path: string,
    metadata: Record<string, string>): Promise<UploadedFile> {
  const buf = await fs.promises.readFile(file_path);
  const form = new FormData();
  form.set("file",
    new Blob([new Uint8Array(buf)], { type: content_type_for(file_path) }),
    path.basename(file_path));
  for (const [name, value] of Object.entries(metadata)) {
    form.set(name, value);
  }
  const res = await fetch(`${base_url}${chat_path}/files/upload`, {
    method: "POST",
    headers: { Cookie: session_cookie },
    body: form,
  });
  const body = await res.text();
  if (res.status !== 200) {
    throw new Error(
      `Upload failed for ${file_path} (HTTP ${res.status}): ${body}`);
  }
  return JSON.parse(body) as UploadedFile;
}

async function wait_until_terminal(
    base_url: string,
    session_cookie: string,
    chat_path: string,
    initial: UploadedFile,
    interval_ms: number,
    timeout_ms: number,
    on_status: (status: string) => void): Promise<UploadedFile> {
  on_status(initial.status);
  if (TERMINAL_STATUSES.has(initial.status)) return initial;
  const deadline = Date.now() + timeout_ms;
  let status = initial.status;
  while (true) {
    if (Date.now() >= deadline) {
      throw new Error(
        `Status polling timed out after ${timeout_ms}ms for file `
        + `${initial.id} (last status: ${status})`);
    }
    await new Promise((r) => setTimeout(r, interval_ms));
    const res = await fetch(
      `${base_url}${chat_path}/files/status/${encodeURIComponent(initial.id)}`,
      { method: "GET", headers: { Cookie: session_cookie } });
    const body = await res.text();
    if (res.status !== 200) {
      throw new Error(
        `Status fetch failed for ${initial.id} (HTTP ${res.status}): ${body}`);
    }
    const next = (JSON.parse(body) as { id: string; status: string }).status;
    if (next !== status) on_status(next);
    status = next;
    if (TERMINAL_STATUSES.has(status)) return { id: initial.id, status };
  }
}

// CLI driver — when run via `npm run grant-review-full`, exercise the
// function against a live server and print the response. Progress goes to
// stderr; the final JSON result goes to stdout so it stays pipe-friendly.
// Throws on any failure, which surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const rfa_path = process.argv[2];
  const companion_path = process.argv[3];
  if (!rfa_path || !companion_path) {
    console.error(
      "Usage: grant-review-full <rfa-path> <companion-path> [mode] [base-url]");
    process.exit(2);
  }
  const result = await grant_review_full({
    base_url: process.argv[5] ?? "http://localhost:8080",
    rfa_path,
    companion_path,
    mode: process.argv[4] ?? "standard",
    title: process.env.TITLE ?? "Grant review full test",
    username: process.env.TEST_USERNAME ?? "testuser",
    password: process.env.TEST_PASSWORD ?? "irrelevant",
    poll_interval_ms: Number(process.env.POLL_INTERVAL_MS ?? 1000),
    poll_timeout_ms: Number(process.env.POLL_TIMEOUT_MS ?? 60000),
    on_progress: (msg) => console.error(msg),
  });
  console.log(JSON.stringify(result, null, 2));
}
