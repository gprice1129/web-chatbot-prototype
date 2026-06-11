// Standalone example/test for POST /api/applications/ally.
//
// Reading this file shows the Ally chatbot protocol (authenticate, then POST
// the chat id with a free-text `message`). Unlike the one-shot grant reviewer,
// Ally is conversational: the handler replays the chat's prior user/assistant
// messages from the database into the model's memory, appends the new message,
// and answers under the Ally persona. The exchange (user message + assistant
// reply) is then recorded on the chat. Response: `{ message: string[] }`.
//
//   npm run ally -- <chat-id> [message] [base-url]
//
// The server must be running with APP_ENV=test, which seeds `testuser` and
// configures the testing auth service to ignore the password. <chat-id> must
// be a chat owned by `testuser` (typically from `npm run chat-create`). No
// file uploads are required — Ally takes no files.
//
// With no [message], the CLI driver runs a short scripted conversation that
// exercises the three behaviours worth eyeballing: domain knowledge (UAB /
// Hugh Kaul), the grant-reviewer hand-off link, and multi-turn memory. Because
// memory is rebuilt from the chat's stored messages, each turn is a fresh
// login yet still sees the earlier turns. Confirm the persisted transcript
// with `npm run chat-messages-get -- <chat-id>`.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface AllyOptions {
  base_url: string;
  chat_id: string;
  message: string;
  username: string;
  password: string;
}

interface AllyResult {
  message: string[];
}

export async function ally(opts: AllyOptions): Promise<AllyResult> {
  // 1. Login. The response sets a signed `session` cookie that gated routes
  //    (including /applications/ally) require on subsequent requests.
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

  // 2. POST the chat id and the user's message. The handler validates that the
  //    chat belongs to the user (404 otherwise), loads prior user/assistant
  //    turns for conversational memory, generates a reply, and records both the
  //    user message and the assistant reply on the chat. Response:
  //    `{ message: string[] }` — the reply's text blocks.
  const ally_res = await fetch(
    `${opts.base_url}/api/applications/ally`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: session_cookie,
      },
      body: JSON.stringify({ chat_id: opts.chat_id, message: opts.message }),
    });
  const body = await ally_res.text();
  if (ally_res.status !== 200) {
    throw new Error(
      `Ally failed (HTTP ${ally_res.status}): ${body}`);
  }
  return JSON.parse(body) as AllyResult;
}

// CLI driver — when run via `npm run ally`, exercise the function against a
// live server and print the response. Throws on any failure, which surfaces as
// a non-zero exit code. With no explicit message it runs a multi-turn
// conversation so the chatbot's memory and app hand-off are visible.
if (import.meta.url === `file://${process.argv[1]}`) {
  const chat_id = process.argv[2];
  if (!chat_id) {
    console.error("Usage: ally <chat-id> [message] [base-url]");
    process.exit(2);
  }
  const base_url = process.argv[4] ?? "http://localhost:8080";
  const username = process.env.USERNAME ?? "testuser";
  const password = process.env.PASSWORD ?? "irrelevant";

  // A single explicit message overrides the default scripted conversation.
  const single = process.argv[3];
  const conversation = single ? [single] : [
    "Hi Ally! In one sentence, what is the Hugh Kaul Precision Medicine Institute?",
    "I need to evaluate a grant proposal against an RFA. Is there a tool on this site for that?",
    "Thanks. To check you followed along — what did I just say I wanted to do?",
  ];

  for (const message of conversation) {
    const result = await ally({ base_url, chat_id, message, username, password });
    console.log(`\n> ${message}\n`);
    console.log(result.message.join("\n"));
  }
}
