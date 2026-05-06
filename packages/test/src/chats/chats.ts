// Standalone example/test for POST /api/chats.
//
// Reading this file shows the full create-chat protocol (authenticate, then
// POST with the application id in the JSON body). Running it against a
// live server asserts that the route works end-to-end:
//
//   npm run chats -- <application-id> [base-url]
//
// The server must be running with APP_ENV=test, which seeds `testuser` and
// configures the testing auth service to ignore the password. The
// applications table must contain a row matching <application-id> with
// enabled = true (see config/db/seed/ for the seeded entries; the id can
// also be fetched via `npm run applications`).

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface ChatCreateOptions {
  base_url: string;
  application_id: string;
  username: string;
  password: string;
}

interface ChatCreateResult {
  id: string;
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

  // 2. Create the chat. application_id goes in the JSON body. The route
  //    returns { id } where id is the new chat's uuid. A 400 with
  //    "application_id is unknown or disabled" indicates the application
  //    row is missing or has enabled = false.
  const create_res = await fetch(`${opts.base_url}/api/chats`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: session_cookie,
    },
    body: JSON.stringify({ application_id: opts.application_id }),
  });
  const body = await create_res.text();
  if (create_res.status !== 200) {
    throw new Error(
      `Chat create failed (HTTP ${create_res.status}): ${body}`);
  }
  return JSON.parse(body) as ChatCreateResult;
}

// CLI driver — when run via `npm run chats`, exercise the function against a
// live server and print the response. Throws on any failure, which surfaces
// as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const application_id = process.argv[2];
  if (!application_id) {
    console.error("Usage: chats <application-id> [base-url]");
    process.exit(2);
  }
  const result = await chat_create({
    base_url: process.argv[3] ?? "https://localhost",
    application_id,
    username: process.env.USERNAME ?? "testuser",
    password: process.env.PASSWORD ?? "irrelevant",
  });
  console.log(JSON.stringify(result, null, 2));
}
