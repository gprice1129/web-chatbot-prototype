// Standalone example/test for GET /api/chats.
//
// Reading this file shows the full list-chats protocol (authenticate, then
// GET /chats). Running it against a live server asserts that the route works
// end-to-end:
//
//   npm run chat-get -- [base-url]
//
// The server must be running with APP_ENV=test, which seeds `testuser` and
// configures the testing auth service to ignore the password.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface ChatGetOptions {
  base_url: string;
  username: string;
  password: string;
}

interface ChatSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface ChatGetResult {
  chats: ChatSummary[];
}

export async function chat_get(opts: ChatGetOptions): Promise<ChatGetResult> {
  // 1. Login. The response sets a signed `session` cookie that gated routes
  //    (including /chats) require on subsequent requests.
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

  // 2. List chats. The route returns `{ chats: [{ id, title, created_at,
  //    updated_at }, ...] }` for chats owned by the authenticated user.
  const get_res = await fetch(`${opts.base_url}/api/chats`, {
    method: "GET",
    headers: { Cookie: session_cookie },
  });
  const body = await get_res.text();
  if (get_res.status !== 200) {
    throw new Error(
      `Chat get failed (HTTP ${get_res.status}): ${body}`);
  }
  return JSON.parse(body) as ChatGetResult;
}

// CLI driver — when run via `npm run chat-get`, exercise the function against
// a live server and print the response. Throws on any failure, which surfaces
// as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await chat_get({
    base_url: process.argv[2] ?? "http://localhost:8080",
    username: process.env.TEST_USERNAME ?? "testuser",
    password: process.env.TEST_PASSWORD ?? "irrelevant",
  });
  console.log(JSON.stringify(result, null, 2));
}
