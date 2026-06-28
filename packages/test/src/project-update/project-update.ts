// Standalone example/test for PATCH /api/projects/:project_id.
//
// Reading this file shows the full update protocol (authenticate, then PATCH
// the project with a new name). Running it against a live server asserts that
// the route works end-to-end:
//
//   npm run project-update -- <project-id> <name> [base-url]
//
// The server must be running with APP_ENV=test, which seeds `testuser` and
// configures the testing auth service to ignore the password. <project-id> must
// be a project owned by `testuser` — typically obtained from
// `npm run project-create`.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface ProjectUpdateOptions {
  base_url: string;
  project_id: string;
  name: string;
  username: string;
  password: string;
}

interface ProjectUpdateResult {
  id: string;
  name: string;
}

export async function project_update(
    opts: ProjectUpdateOptions): Promise<ProjectUpdateResult> {
  // 1. Login. The response sets a signed `session` cookie that gated routes
  //    (including /projects/:project_id) require on subsequent requests.
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

  // 2. Update the project. The project_id in the path is validated by the
  //    project-validate hook — a project the user does not own returns 404
  //    before the handler runs. The body is JSON `{ name }`; the response
  //    echoes back the persisted `{ id, name }`.
  const update_res = await fetch(
    `${opts.base_url}/api/projects/${encodeURIComponent(opts.project_id)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: session_cookie,
      },
      body: JSON.stringify({ name: opts.name }),
    });
  const body = await update_res.text();
  if (update_res.status !== 200) {
    throw new Error(
      `Project update failed (HTTP ${update_res.status}): ${body}`);
  }
  return JSON.parse(body) as ProjectUpdateResult;
}

// CLI driver — when run via `npm run project-update`, exercise the function
// against a live server and print the response. Throws on any failure, which
// surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const project_id = process.argv[2];
  const name = process.argv[3];
  if (!project_id || !name) {
    console.error("Usage: project-update <project-id> <name> [base-url]");
    process.exit(2);
  }
  const result = await project_update({
    base_url: process.argv[4] ?? "http://localhost:8080",
    project_id,
    name,
    username: process.env.TEST_USERNAME ?? "testuser",
    password: process.env.TEST_PASSWORD ?? "irrelevant",
  });
  console.log(JSON.stringify(result, null, 2));
}
