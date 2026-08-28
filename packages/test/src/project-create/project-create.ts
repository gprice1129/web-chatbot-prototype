// Standalone example/test for POST /api/projects.
//
// Reading this file shows the full create-project protocol (authenticate, then
// POST a JSON body with `name`). Running it against a live server asserts that
// the route works end-to-end:
//
//   npm run project-create -- <name> [base-url]
//
// The server must be running with AUTH_MODE=mock, which seeds `testuser` and
// configures the mock auth service to ignore the password.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface ProjectCreateOptions {
  base_url: string;
  name: string;
  username: string;
  password: string;
}

interface ProjectCreateResult {
  id: string;
  name: string;
}

export async function project_create(
    opts: ProjectCreateOptions): Promise<ProjectCreateResult> {
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

  // 2. Create the project. The route requires a JSON body `{ name }` and
  //    returns `{ id, name }` for the newly created project.
  const create_res = await fetch(`${opts.base_url}/api/projects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: session_cookie,
    },
    body: JSON.stringify({ name: opts.name }),
  });
  const body = await create_res.text();
  if (create_res.status !== 200) {
    throw new Error(
      `Project create failed (HTTP ${create_res.status}): ${body}`);
  }
  return JSON.parse(body) as ProjectCreateResult;
}

// CLI driver — when run via `npm run project-create`, exercise the function
// against a live server and print the response. Throws on any failure, which
// surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const name = process.argv[2];
  if (!name) {
    console.error("Usage: project-create <name> [base-url]");
    process.exit(2);
  }
  const result = await project_create({
    base_url: process.argv[3] ?? "http://localhost:8080",
    name,
    username: process.env.TEST_USERNAME ?? "testuser",
    password: process.env.TEST_PASSWORD ?? "irrelevant",
  });
  console.log(JSON.stringify(result, null, 2));
}
