// Standalone example/test for POST /api/chats/:chat_id/files/upload.
//
// Reading this file shows the full upload protocol (authenticate, then post a
// multipart `file` part scoped to a chat the user owns). Running it against
// a live server asserts that the route works end-to-end:
//
//   npm run file-upload -- <chat-id> <path-to-file> [base-url]
//
// A second mode posts a fixed matrix of synthetic uploads and asserts the
// media-type gate accepts and rejects the right ones (no file on disk needed):
//
//   npm run file-upload -- --cases <chat-id> [base-url]
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
  metadata?: Record<string, string>;
}

interface FileUploadResult {
  id: string;
  status: string;
}

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

// Authenticate and return the signed `session` cookie that gated routes
// (including /files/upload) require. Callers that make several upload attempts
// must reuse one cookie: /api/login is rate limited per client IP, so logging
// in per attempt trips a 429 partway through a run.
async function login(
    base_url: string, username: string, password: string): Promise<string> {
  const login_res = await fetch(`${base_url}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
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
  return session_cookie;
}

export async function file_upload(
    opts: FileUploadOptions): Promise<FileUploadResult> {
  // 1. Login.
  const session_cookie = await login(
    opts.base_url, opts.username, opts.password);

  // 2. Upload. The route expects multipart/form-data with a single `file`
  //    part. The server sniffs the MIME type from the bytes; the filename is
  //    preserved as the file's display name. Any additional non-file fields
  //    are stored on the file row as string-valued metadata. The chat_id in
  //    the path is validated by the chat-validate hook — a chat the user does
  //    not own returns 404 before the upload runs.
  const buf = await fs.promises.readFile(opts.file_path);
  const form = new FormData();
  form.set("file",
    new Blob([new Uint8Array(buf)], { type: content_type_for(opts.file_path) }),
    path.basename(opts.file_path));
  for (const [name, value] of Object.entries(opts.metadata ?? {})) {
    form.set(name, value);
  }

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

// ---------------------------------------------------------------------------
// Media-type gate cases
// ---------------------------------------------------------------------------

// The upload route resolves a mime type in three steps, and each of these cases
// pins one of them:
//   1. sniff the bytes (settles pdf/docx),
//   2. otherwise take the declared type if it is text/plain or text/markdown,
//      or — when the client declared application/octet-stream, i.e. nothing
//      useful — infer it from the filename extension,
//   3. for a text type, confirm the content really is UTF-8 text.
// Anything that does not survive all three is 415.

interface UploadCase {
  name: string;
  filename: string;
  // The multipart part's Content-Type. "" is what a browser sends when the OS
  // has no mapping for the extension; undici puts application/octet-stream on
  // the wire for it, exactly as a browser does.
  content_type: string;
  body: Uint8Array;
  expect_status: number;
}

const text = (s: string) => new TextEncoder().encode(s);

const UPLOAD_CASES: readonly UploadCase[] = [
  {
    // The case this matrix exists for: a .md from a client with no registered
    // mapping for the extension. Declares nothing usable, so the filename
    // settles it rather than the upload being rejected.
    name: "markdown declared as octet-stream is accepted on its extension",
    filename: "notes.md",
    content_type: "application/octet-stream",
    body: text("# Notes\n\nUploaded by the file-upload case matrix.\n"),
    expect_status: 200,
  },
  {
    // Same declaration, but nothing in the name to fall back to.
    name: "octet-stream with an unusable extension is rejected",
    filename: "notes.bin",
    content_type: "application/octet-stream",
    body: text("plain text under an unknown extension\n"),
    expect_status: 415,
  },
  {
    // A declared type we do not accept is taken at its word — the .md name does
    // not rescue it. Only an absent declaration defers to the filename.
    name: "an unsupported declared type is not rescued by the filename",
    filename: "notes.md",
    content_type: "text/html",
    body: text("# Notes\n"),
    expect_status: 415,
  },
  {
    // Text types have no magic bytes, so the declaration is only as good as the
    // client. A NUL byte this early means the content is not text, whatever the
    // client said. Bytes chosen so sniffing does not recognize them either.
    name: "binary content declared as text is rejected",
    filename: "notes.txt",
    content_type: "text/plain",
    body: Uint8Array.from([0x41, 0x42, 0x00, 0x43, 0x44]),
    expect_status: 415,
  },
  {
    // "café" as latin-1: a bare 0xe9 is not valid UTF-8. Everything downstream
    // decodes as UTF-8, so this is rejected rather than stored as mojibake.
    name: "latin-1 content declared as markdown is rejected",
    filename: "notes.md",
    content_type: "text/markdown",
    body: Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x0a]),
    expect_status: 415,
  },
];

interface UploadCaseResult {
  name: string;
  expect_status: number;
  actual_status: number;
  passed: boolean;
  body: string;
}

interface UploadCasesOptions {
  base_url: string;
  chat_id: string;
  username: string;
  password: string;
}

// Runs every case against a live server and asserts each got the status the
// media-type gate owes it. Re-runnable: the accepted case dedups by content
// checksum on a second run, which still answers 200.
export async function file_upload_cases(
    opts: UploadCasesOptions): Promise<UploadCaseResult[]> {
  const session_cookie = await login(
    opts.base_url, opts.username, opts.password);
  const url =
    `${opts.base_url}/api/chats/${encodeURIComponent(opts.chat_id)}/files/upload`;

  const results: UploadCaseResult[] = [];
  for (const c of UPLOAD_CASES) {
    const form = new FormData();
    form.set("file",
      new Blob([new Uint8Array(c.body)], { type: c.content_type }), c.filename);
    const res = await fetch(
      url, { method: "POST", headers: { Cookie: session_cookie }, body: form });
    const body = await res.text();
    results.push({
      name: c.name,
      expect_status: c.expect_status,
      actual_status: res.status,
      passed: res.status === c.expect_status,
      body,
    });
  }

  // Report the whole matrix before failing — one bad case should not hide the
  // status of the rest.
  const failed = results.filter((r) => !r.passed);
  if (failed.length > 0) {
    const detail = failed
      .map((r) => `  - ${r.name}: expected ${r.expect_status}, got ${r.actual_status} (${r.body})`)
      .join("\n");
    throw new Error(
      `${failed.length} of ${results.length} upload cases failed:\n${detail}`);
  }
  return results;
}

// CLI driver — when run via `npm run file-upload`, exercise the function
// against a live server and print the response. Throws on any failure, which
// surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const cases_mode = args.includes("--cases");
  const positional = args.filter((a) => !a.startsWith("--"));
  const username = process.env.TEST_USERNAME ?? "testuser";
  const password = process.env.TEST_PASSWORD ?? "irrelevant";

  if (cases_mode) {
    const chat_id = positional[0];
    if (!chat_id) {
      console.error("Usage: file-upload --cases <chat-id> [base-url]");
      process.exit(2);
    }
    const results = await file_upload_cases({
      base_url: positional[1] ?? "http://localhost:8080",
      chat_id,
      username,
      password,
    });
    for (const r of results) {
      console.log(`ok  ${r.actual_status}  ${r.name}`);
    }
    console.log(`PASS: ${results.length} upload cases behaved as expected.`);
  } else {
    const chat_id = positional[0];
    const file_path = positional[1];
    if (!chat_id || !file_path) {
      console.error(
        "Usage: file-upload <chat-id> <path-to-file> [base-url]\n" +
        "       file-upload --cases <chat-id> [base-url]");
      process.exit(2);
    }
    const result = await file_upload({
      base_url: positional[2] ?? "http://localhost:8080",
      chat_id,
      file_path,
      username,
      password,
      metadata: { source: "file-upload-cli" },
    });
    console.log(JSON.stringify(result, null, 2));
  }
}
