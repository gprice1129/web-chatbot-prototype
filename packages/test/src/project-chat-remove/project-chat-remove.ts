// Standalone example/test for DELETE /api/projects/:project_id/chats/:chat_id.
//
// Reading this file shows the full remove-chat-from-project protocol
// (authenticate, then DELETE the membership). Running it against a live server
// asserts that the route works end-to-end:
//
//   npm run project-chat-remove -- <project-id> <chat-id> [base-url]
//
// The server must be running with AUTH_MODE=mock, which seeds `testuser` and
// configures the mock auth service to ignore the password. <project-id> must
// belong to `testuser` and <chat-id> must currently be a member of it;
// removing a chat that is not a member returns 404.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface ProjectChatRemoveOptions {
  base_url: string;
  project_id: string;
  chat_id: string;
  username: string;
  password: string;
}

interface ProjectChatRemoveResult {
  message: string;
}

export async function project_chat_remove(
    opts: ProjectChatRemoveOptions): Promise<ProjectChatRemoveResult> {
  // 1. Login. The response sets a signed `session` cookie that gated routes
  //    (including /projects/:project_id/chats/:chat_id) require on subsequent
  //    requests.
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

  // 2. Remove the chat from the project. The project_id in the path is
  //    validated by the project-validate hook. Removing a chat that is not a
  //    member returns 404. The response is JSON `{ message }`.
  const remove_res = await fetch(
    `${opts.base_url}/api/projects/${encodeURIComponent(opts.project_id)}` +
    `/chats/${encodeURIComponent(opts.chat_id)}`,
    {
      method: "DELETE",
      headers: { Cookie: session_cookie },
    });
  const body = await remove_res.text();
  if (remove_res.status !== 200) {
    throw new Error(
      `Project chat remove failed (HTTP ${remove_res.status}): ${body}`);
  }
  return JSON.parse(body) as ProjectChatRemoveResult;
}

// CLI driver — when run via `npm run project-chat-remove`, exercise the function
// against a live server and print the response. Throws on any failure, which
// surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const project_id = process.argv[2];
  const chat_id = process.argv[3];
  if (!project_id || !chat_id) {
    console.error("Usage: project-chat-remove <project-id> <chat-id> [base-url]");
    process.exit(2);
  }
  const result = await project_chat_remove({
    base_url: process.argv[4] ?? "http://localhost:8080",
    project_id,
    chat_id,
    username: process.env.TEST_USERNAME ?? "testuser",
    password: process.env.TEST_PASSWORD ?? "irrelevant",
  });
  console.log(JSON.stringify(result, null, 2));
}
