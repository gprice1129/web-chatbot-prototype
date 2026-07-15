// Standalone example/test for GET /api/projects.
//
// Reading this file shows the full list-projects protocol (authenticate, then
// GET /projects). Running it against a live server asserts that the route works
// end-to-end:
//
//   npm run project-get -- [base-url]
//
// The server must be running with APP_ENV=test, which seeds `testuser` and
// configures the testing auth service to ignore the password.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface ProjectGetOptions {
  base_url: string;
  username: string;
  password: string;
}

interface ProjectSummary {
  id: string;
  name: string;
  memory_enabled: boolean;
  created_at: string;
  updated_at: string;
}

interface ProjectGetResult {
  projects: ProjectSummary[];
}

export async function project_get(opts: ProjectGetOptions): Promise<ProjectGetResult> {
  // 1. Login. The response sets a signed `session` cookie that gated routes
  //    (including /projects) require on subsequent requests.
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

  // 2. List projects. The route returns `{ projects: [{ id, name,
  //    memory_enabled, created_at, updated_at }, ...] }` for projects owned by
  //    the authenticated user.
  const get_res = await fetch(`${opts.base_url}/api/projects`, {
    method: "GET",
    headers: { Cookie: session_cookie },
  });
  const body = await get_res.text();
  if (get_res.status !== 200) {
    throw new Error(
      `Project get failed (HTTP ${get_res.status}): ${body}`);
  }
  return JSON.parse(body) as ProjectGetResult;
}

// CLI driver — when run via `npm run project-get`, exercise the function against
// a live server and print the response. Throws on any failure, which surfaces
// as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await project_get({
    base_url: process.argv[2] ?? "http://localhost:8080",
    username: process.env.TEST_USERNAME ?? "testuser",
    password: process.env.TEST_PASSWORD ?? "irrelevant",
  });
  console.log(JSON.stringify(result, null, 2));
}
