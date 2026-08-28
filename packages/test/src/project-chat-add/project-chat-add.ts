// Standalone example/test for POST /api/projects/:project_id/chats.
//
// Reading this file shows the full add-chat-to-project protocol (authenticate,
// then POST a JSON body with `chat_id`). Running it against a live server
// asserts that the route works end-to-end:
//
//   npm run project-chat-add -- <project-id> <chat-id> [base-url]
//
// The server must be running with AUTH_MODE=mock, which seeds `testuser` and
// configures the mock auth service to ignore the password. Both <project-id>
// and <chat-id> must belong to `testuser` — typically obtained from
// `npm run project-create` and `npm run chat-create`. Adding an already-linked
// chat is idempotent.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface ProjectChatAddOptions {
  base_url: string;
  project_id: string;
  chat_id: string;
  username: string;
  password: string;
}

interface ProjectChatAddResult {
  message: string;
}

export async function project_chat_add(
    opts: ProjectChatAddOptions): Promise<ProjectChatAddResult> {
  // 1. Login. The response sets a signed `session` cookie that gated routes
  //    (including /projects/:project_id/chats) require on subsequent requests.
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

  // 2. Add the chat to the project. The project_id in the path is validated by
  //    the project-validate hook; the chat_id in the body is checked for
  //    ownership in the handler (a chat the user does not own returns 404). The
  //    response is JSON `{ message }`.
  const add_res = await fetch(
    `${opts.base_url}/api/projects/${encodeURIComponent(opts.project_id)}/chats`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: session_cookie,
      },
      body: JSON.stringify({ chat_id: opts.chat_id }),
    });
  const body = await add_res.text();
  if (add_res.status !== 200) {
    throw new Error(
      `Project chat add failed (HTTP ${add_res.status}): ${body}`);
  }
  return JSON.parse(body) as ProjectChatAddResult;
}

// CLI driver — when run via `npm run project-chat-add`, exercise the function
// against a live server and print the response. Throws on any failure, which
// surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const project_id = process.argv[2];
  const chat_id = process.argv[3];
  if (!project_id || !chat_id) {
    console.error("Usage: project-chat-add <project-id> <chat-id> [base-url]");
    process.exit(2);
  }
  const result = await project_chat_add({
    base_url: process.argv[4] ?? "http://localhost:8080",
    project_id,
    chat_id,
    username: process.env.TEST_USERNAME ?? "testuser",
    password: process.env.TEST_PASSWORD ?? "irrelevant",
  });
  console.log(JSON.stringify(result, null, 2));
}
