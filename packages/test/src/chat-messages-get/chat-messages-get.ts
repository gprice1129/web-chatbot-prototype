// Standalone example/test for GET /api/chats/:chat_id/messages.
//
// Reading this file shows the full list-messages protocol (authenticate, then
// GET the chat's messages). Running it against a live server asserts that the
// route works end-to-end:
//
//   npm run chat-messages-get -- <chat-id> [base-url]
//
// The server must be running with APP_ENV=test, which seeds `testuser` and
// configures the testing auth service to ignore the password. <chat-id> must
// be a chat owned by `testuser` — typically obtained from `npm run chat-create`.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface ChatMessagesGetOptions {
  base_url: string;
  chat_id: string;
  username: string;
  password: string;
}

interface ChatMessage {
  id: string;
  chat_id: string;
  role: string;
  content: string;
  metadata: Record<string, unknown>;
  file_ids: string[];
  created_at: string;
}

interface ChatMessagesGetResult {
  messages: ChatMessage[];
}

export async function chat_messages_get(
    opts: ChatMessagesGetOptions): Promise<ChatMessagesGetResult> {
  // 1. Login. The response sets a signed `session` cookie that gated routes
  //    (including /chats/:chat_id/messages) require on subsequent requests.
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

  // 2. List messages. The chat_id in the path is validated by the
  //    chat-validate hook — a chat the user does not own returns 404 before
  //    the handler runs. The response is `{ messages: [{ id, chat_id, role,
  //    content, metadata, file_ids, created_at }, ...] }` ordered by
  //    created_at ASC. `file_ids` holds the uuids of files attached to each
  //    message; hydrate to full metadata via POST /chats/:chat_id/files/info
  //    (see `npm run files-info`).
  const get_res = await fetch(
    `${opts.base_url}/api/chats/${encodeURIComponent(opts.chat_id)}/messages`,
    {
      method: "GET",
      headers: { Cookie: session_cookie },
    });
  const body = await get_res.text();
  if (get_res.status !== 200) {
    throw new Error(
      `Chat messages get failed (HTTP ${get_res.status}): ${body}`);
  }
  return JSON.parse(body) as ChatMessagesGetResult;
}

// CLI driver — when run via `npm run chat-messages-get`, exercise the
// function against a live server and print the response. Throws on any
// failure, which surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const chat_id = process.argv[2];
  if (!chat_id) {
    console.error("Usage: chat-messages-get <chat-id> [base-url]");
    process.exit(2);
  }
  const result = await chat_messages_get({
    base_url: process.argv[3] ?? "http://localhost:8080",
    chat_id,
    username: process.env.TEST_USERNAME ?? "testuser",
    password: process.env.TEST_PASSWORD ?? "irrelevant",
  });
  console.log(JSON.stringify(result, null, 2));
}
