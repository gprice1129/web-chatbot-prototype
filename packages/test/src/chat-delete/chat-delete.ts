// Standalone example/test for DELETE /api/chats/:chat_id.
//
// Reading this file shows the full delete protocol (authenticate, then DELETE
// the chat). Running it against a live server asserts that the route works
// end-to-end:
//
//   npm run chat-delete -- <chat-id> [base-url]
//
// The server must be running with AUTH_MODE=mock, which seeds `testuser` and
// configures the mock auth service to ignore the password. <chat-id> must
// be a chat owned by `testuser` — typically obtained from `npm run chat-create`.
// Deleting cascades in the database to the chat's messages and file/project
// link rows; a chat the user does not own (or already deleted) returns 404.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface ChatDeleteOptions {
  base_url: string;
  chat_id: string;
  username: string;
  password: string;
}

interface ChatDeleteResult {
  message: string;
}

export async function chat_delete(
    opts: ChatDeleteOptions): Promise<ChatDeleteResult> {
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

  // 2. Delete the chat. The chat_id in the path is validated by the
  //    chat-validate hook — a chat the user does not own returns 404 before
  //    the handler runs. The response is JSON `{ message }`.
  const delete_res = await fetch(
    `${opts.base_url}/api/chats/${encodeURIComponent(opts.chat_id)}`,
    {
      method: "DELETE",
      headers: { Cookie: session_cookie },
    });
  const body = await delete_res.text();
  if (delete_res.status !== 200) {
    throw new Error(
      `Chat delete failed (HTTP ${delete_res.status}): ${body}`);
  }
  return JSON.parse(body) as ChatDeleteResult;
}

// CLI driver — when run via `npm run chat-delete`, exercise the function
// against a live server and print the response. Throws on any failure, which
// surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const chat_id = process.argv[2];
  if (!chat_id) {
    console.error("Usage: chat-delete <chat-id> [base-url]");
    process.exit(2);
  }
  const result = await chat_delete({
    base_url: process.argv[3] ?? "http://localhost:8080",
    chat_id,
    username: process.env.TEST_USERNAME ?? "testuser",
    password: process.env.TEST_PASSWORD ?? "irrelevant",
  });
  console.log(JSON.stringify(result, null, 2));
}
