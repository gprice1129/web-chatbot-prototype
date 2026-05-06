// Standalone example/test for GET /api/applications.
//
// Reading this file shows the full protocol (authenticate, then GET the
// list). Running it against a live server asserts that the route works
// end-to-end:
//
//   npm run applications -- [base-url]
//
// The server must be running with APP_ENV=test, which seeds `testuser` and
// configures the testing auth service to ignore the password.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface ApplicationsOptions {
  base_url: string;
  username: string;
  password: string;
}

interface Application {
  id: string;
  name: string;
  description?: string;
}

interface ApplicationsResult {
  applications: Application[];
}

export async function applications(
    opts: ApplicationsOptions): Promise<ApplicationsResult> {
  // 1. Login. The response sets a signed `session` cookie that gated routes
  //    (including /applications) require on subsequent requests.
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

  // 2. Fetch the enabled applications. The route returns
  //    { applications: [{ id, name, description? }] }, ordered by created_at.
  //    description is omitted when null.
  const apps_res = await fetch(`${opts.base_url}/api/applications`, {
    method: "GET", headers: { Cookie: session_cookie } });
  const body = await apps_res.text();
  if (apps_res.status !== 200) {
    throw new Error(
      `Applications fetch failed (HTTP ${apps_res.status}): ${body}`);
  }
  return JSON.parse(body) as ApplicationsResult;
}

// CLI driver — when run via `npm run applications`, exercise the function
// against a live server and print the response. Throws on any failure, which
// surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await applications({
    base_url: process.argv[2] ?? "https://localhost",
    username: process.env.USERNAME ?? "testuser",
    password: process.env.PASSWORD ?? "irrelevant",
  });
  console.log(JSON.stringify(result, null, 2));
}
