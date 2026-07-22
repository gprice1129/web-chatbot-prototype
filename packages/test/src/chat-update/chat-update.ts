// Standalone example/test for PATCH /api/chats/:chat_id.
//
// Reading this file shows the full update protocol (authenticate, then PATCH
// the chat with a new title). Running it against a live server asserts that
// the route works end-to-end:
//
//   npm run chat-update -- <chat-id> <title> [base-url]
//
// The server must be running with APP_ENV=test, which seeds `testuser` and
// configures the testing auth service to ignore the password. <chat-id> must
// be a chat owned by `testuser` — typically obtained from `npm run chat-create`.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface ChatUpdateOptions {
  base_url: string;
  chat_id: string;
  title: string;
  username: string;
  password: string;
}

interface ChatUpdateResult {
  id: string;
  title: string;
}

export async function chat_update(
    opts: ChatUpdateOptions): Promise<ChatUpdateResult> {
  // 1. Login. The response sets a signed `session` cookie that gated routes
  //    (including /chats/:chat_id) require on subsequent requests.
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

  // 2. Update the chat. The chat_id in the path is validated by the
  //    chat-validate hook — a chat the user does not own returns 404 before
  //    the handler runs. The body is JSON `{ title }`; the response echoes
  //    back the persisted `{ id, title }`.
  const update_res = await fetch(
    `${opts.base_url}/api/chats/${encodeURIComponent(opts.chat_id)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: session_cookie,
      },
      body: JSON.stringify({ title: opts.title }),
    });
  const body = await update_res.text();
  if (update_res.status !== 200) {
    throw new Error(
      `Chat update failed (HTTP ${update_res.status}): ${body}`);
  }
  return JSON.parse(body) as ChatUpdateResult;
}

// CLI driver — when run via `npm run chat-update`, exercise the function
// against a live server and print the response. Throws on any failure, which
// surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const chat_id = process.argv[2];
  const title = process.argv[3];
  if (!chat_id || !title) {
    console.error("Usage: chat-update <chat-id> <title> [base-url]");
    process.exit(2);
  }
  const result = await chat_update({
    base_url: process.argv[4] ?? "http://localhost:8080",
    chat_id,
    title,
    username: process.env.TEST_USERNAME ?? "testuser",
    password: process.env.TEST_PASSWORD ?? "irrelevant",
  });
  console.log(JSON.stringify(result, null, 2));
}
