// Standalone example/test for DELETE /api/projects/:project_id.
//
// Reading this file shows the full delete protocol (authenticate, then DELETE
// the project). Running it against a live server asserts that the route works
// end-to-end:
//
//   npm run project-delete -- <project-id> [base-url]
//
// The server must be running with APP_ENV=test, which seeds `testuser` and
// configures the testing auth service to ignore the password. <project-id> must
// be a project owned by `testuser`. Deleting a project removes only the
// project_chats link rows — its member chats survive.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface ProjectDeleteOptions {
  base_url: string;
  project_id: string;
  username: string;
  password: string;
}

interface ProjectDeleteResult {
  message: string;
}

export async function project_delete(
    opts: ProjectDeleteOptions): Promise<ProjectDeleteResult> {
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

  // 2. Delete the project. The project_id in the path is validated by the
  //    project-validate hook — a project the user does not own returns 404
  //    before the handler runs. The response is JSON `{ message }`.
  const delete_res = await fetch(
    `${opts.base_url}/api/projects/${encodeURIComponent(opts.project_id)}`,
    {
      method: "DELETE",
      headers: { Cookie: session_cookie },
    });
  const body = await delete_res.text();
  if (delete_res.status !== 200) {
    throw new Error(
      `Project delete failed (HTTP ${delete_res.status}): ${body}`);
  }
  return JSON.parse(body) as ProjectDeleteResult;
}

// CLI driver — when run via `npm run project-delete`, exercise the function
// against a live server and print the response. Throws on any failure, which
// surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const project_id = process.argv[2];
  if (!project_id) {
    console.error("Usage: project-delete <project-id> [base-url]");
    process.exit(2);
  }
  const result = await project_delete({
    base_url: process.argv[3] ?? "http://localhost:8080",
    project_id,
    username: process.env.USERNAME ?? "testuser",
    password: process.env.PASSWORD ?? "irrelevant",
  });
  console.log(JSON.stringify(result, null, 2));
}
