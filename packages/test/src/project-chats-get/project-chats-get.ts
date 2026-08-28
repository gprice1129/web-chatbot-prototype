// Standalone example/test for GET /api/projects/:project_id/chats.
//
// Reading this file shows the full list-project-chats protocol (authenticate,
// then GET the project's chats). Running it against a live server asserts that
// the route works end-to-end:
//
//   npm run project-chats-get -- <project-id> [base-url]
//
// The server must be running with AUTH_MODE=mock, which seeds `testuser` and
// configures the mock auth service to ignore the password. <project-id> must
// be a project owned by `testuser`.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface ProjectChatsGetOptions {
  base_url: string;
  project_id: string;
  username: string;
  password: string;
}

interface ChatSummary {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface ProjectChatsGetResult {
  chats: ChatSummary[];
}

export async function project_chats_get(
    opts: ProjectChatsGetOptions): Promise<ProjectChatsGetResult> {
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

  // 2. List the project's chats. The project_id in the path is validated by
  //    the project-validate hook. The route returns `{ chats: [{ id, title,
  //    created_at, updated_at }, ...] }` for chats that are members of the
  //    project.
  const get_res = await fetch(
    `${opts.base_url}/api/projects/${encodeURIComponent(opts.project_id)}/chats`,
    {
      method: "GET",
      headers: { Cookie: session_cookie },
    });
  const body = await get_res.text();
  if (get_res.status !== 200) {
    throw new Error(
      `Project chats get failed (HTTP ${get_res.status}): ${body}`);
  }
  return JSON.parse(body) as ProjectChatsGetResult;
}

// CLI driver — when run via `npm run project-chats-get`, exercise the function
// against a live server and print the response. Throws on any failure, which
// surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const project_id = process.argv[2];
  if (!project_id) {
    console.error("Usage: project-chats-get <project-id> [base-url]");
    process.exit(2);
  }
  const result = await project_chats_get({
    base_url: process.argv[3] ?? "http://localhost:8080",
    project_id,
    username: process.env.TEST_USERNAME ?? "testuser",
    password: process.env.TEST_PASSWORD ?? "irrelevant",
  });
  console.log(JSON.stringify(result, null, 2));
}
