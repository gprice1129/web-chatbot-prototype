// Standalone example/test for POST /api/chats.
//
// Reading this file shows the full create-chat protocol (authenticate, then
// POST a JSON body with `title`). Running it against a live server asserts
// that the route works end-to-end:
//
//   npm run chat-create -- <title> [base-url]
//
// The server must be running with APP_ENV=test, which seeds `testuser` and
// configures the testing auth service to ignore the password.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface ChatCreateOptions {
  base_url: string;
  title: string;
  username: string;
  password: string;
}

interface ChatCreateResult {
  id: string;
  title: string;
}

export async function chat_create(
    opts: ChatCreateOptions): Promise<ChatCreateResult> {
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

  // 2. Create the chat. The route requires a JSON body `{ title }` and
  //    returns `{ id, title }` for the newly created chat.
  const create_res = await fetch(`${opts.base_url}/api/chats`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: session_cookie,
    },
    body: JSON.stringify({ title: opts.title }),
  });
  const body = await create_res.text();
  if (create_res.status !== 200) {
    throw new Error(
      `Chat create failed (HTTP ${create_res.status}): ${body}`);
  }
  return JSON.parse(body) as ChatCreateResult;
}

// CLI driver — when run via `npm run chat-create`, exercise the function against a
// live server and print the response. Throws on any failure, which surfaces
// as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const title = process.argv[2];
  if (!title) {
    console.error("Usage: chat-create <title> [base-url]");
    process.exit(2);
  }
  const result = await chat_create({
    base_url: process.argv[3] ?? "http://localhost:8080",
    title,
    username: process.env.USERNAME ?? "testuser",
    password: process.env.PASSWORD ?? "irrelevant",
  });
  console.log(JSON.stringify(result, null, 2));
}
