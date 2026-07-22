// Standalone example/test for POST /api/chats/:chat_id/files/info.
//
// Reading this file shows the batch lookup protocol (authenticate, then POST
// a list of file ids under a chat the user owns). Running it against a live
// server asserts that the route works end-to-end:
//
//   npm run files-info -- <chat-id> <file-id> [<file-id> ...] [-- <base-url>]
//
// The server must be running with APP_ENV=test, which seeds `testuser` and
// configures the testing auth service to ignore the password. <chat-id> must
// be a chat owned by `testuser` — typically obtained from `npm run
// chat-create`. File ids the caller cannot see (wrong owner / wrong chat) are
// silently omitted from the response; compare lengths to detect partial hits.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface FilesInfoOptions {
  base_url: string;
  chat_id: string;
  ids: string[];
  username: string;
  password: string;
}

interface FileInfo {
  id: string;
  original_filename: string | null;
  mime_type: string;
  size_bytes: string;
  status: string;
  metadata: Record<string, unknown>;
}

interface FilesInfoResult {
  files: FileInfo[];
}

export async function files_info(
    opts: FilesInfoOptions): Promise<FilesInfoResult> {
  // 1. Login. The response sets a signed `session` cookie that gated routes
  //    (including /files/info) require on subsequent requests.
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

  // 2. POST the id list. The response is `{ files: [{ id, original_filename,
  //    mime_type, size_bytes, status, metadata }, ...] }`. Ids the user
  //    cannot see are silently omitted — a partial result is normal.
  const info_res = await fetch(
    `${opts.base_url}/api/chats/${encodeURIComponent(opts.chat_id)}/files/info`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: session_cookie,
      },
      body: JSON.stringify({ ids: opts.ids }),
    });
  const body = await info_res.text();
  if (info_res.status !== 200) {
    throw new Error(
      `Files info fetch failed (HTTP ${info_res.status}): ${body}`);
  }
  return JSON.parse(body) as FilesInfoResult;
}

// CLI driver — when run via `npm run files-info`, exercise the function
// against a live server and print the response. Throws on any failure, which
// surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  // Optional trailing `-- <base-url>` separates the file id list from the
  // base url so chat-id + N file ids can be passed positionally.
  let base_url = "http://localhost:8080";
  const sep = args.indexOf("--");
  let positional: string[];
  if (sep >= 0) {
    positional = args.slice(0, sep);
    if (args[sep + 1]) base_url = args[sep + 1]!;
  } else {
    positional = args;
  }
  const [chat_id, ...ids] = positional;
  if (!chat_id || ids.length === 0) {
    console.error(
      "Usage: files-info <chat-id> <file-id> [<file-id> ...] [-- <base-url>]");
    process.exit(2);
  }
  const result = await files_info({
    base_url,
    chat_id,
    ids,
    username: process.env.TEST_USERNAME ?? "testuser",
    password: process.env.TEST_PASSWORD ?? "irrelevant",
  });
  console.log(JSON.stringify(result, null, 2));
}
