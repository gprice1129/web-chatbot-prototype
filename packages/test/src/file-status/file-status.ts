// Standalone example/test for GET /api/chats/:chat_id/files/status/:file_id.
//
// Reading this file shows the full status protocol (authenticate, then GET
// the file id under a chat the user owns). Running it against a live server
// asserts that the route works end-to-end:
//
//   npm run file-status -- <chat-id> <file-id> [base-url]
//
// The server must be running with APP_ENV=test, which seeds `testuser` and
// configures the testing auth service to ignore the password. <chat-id> must
// be a chat owned by `testuser` — typically obtained from `npm run chat-create`.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface FileStatusOptions {
  base_url: string;
  chat_id: string;
  file_id: string;
  username: string;
  password: string;
}

interface FileStatusResult {
  id: string;
  status: string;
}

export async function file_status(
    opts: FileStatusOptions): Promise<FileStatusResult> {
  // 1. Login. The response sets a signed `session` cookie that gated routes
  //    (including /files/status) require on subsequent requests.
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

  // 2. Fetch status. The route returns { id, status } where status is one of
  //    `uploaded`, `queued`, `parsed`, or `parse_failed`. A chat_id the user
  //    does not own — or a file_id the user does not own — returns 404 to
  //    avoid leaking existence across users.
  const status_res = await fetch(
    `${opts.base_url}/api/chats/${encodeURIComponent(opts.chat_id)}`
      + `/files/status/${encodeURIComponent(opts.file_id)}`,
    { method: "GET", headers: { Cookie: session_cookie } });
  const body = await status_res.text();
  if (status_res.status !== 200) {
    throw new Error(
      `Status fetch failed (HTTP ${status_res.status}): ${body}`);
  }
  return JSON.parse(body) as FileStatusResult;
}

// CLI driver — when run via `npm run file-status`, exercise the function
// against a live server and print the response. Throws on any failure, which
// surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const chat_id = process.argv[2];
  const file_id = process.argv[3];
  if (!chat_id || !file_id) {
    console.error("Usage: file-status <chat-id> <file-id> [base-url]");
    process.exit(2);
  }
  const result = await file_status({
    base_url: process.argv[4] ?? "http://localhost:8080",
    chat_id,
    file_id,
    username: process.env.TEST_USERNAME ?? "testuser",
    password: process.env.TEST_PASSWORD ?? "irrelevant",
  });
  console.log(JSON.stringify(result, null, 2));
}
