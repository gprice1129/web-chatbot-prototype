// Standalone example/test for POST /api/applications/grant_review.
//
// Reading this file shows the grant review protocol (authenticate, then POST
// the chat id with a mode query parameter). The handler resolves the rfa
// and companion file (proposal for non-AIMS modes, aims for AIMS) from the
// chat's uploaded files by `metadata.role`, runs the grant reviewer, and
// records the result as an ASSISTANT message on the chat.
//
//   npm run grant-review -- <chat-id> [mode] [base-url]
//
// The server must be running with APP_ENV=test, which seeds `testuser` and
// configures the testing auth service to ignore the password. <chat-id>
// must be a chat owned by `testuser` (typically from `npm run chat-create`)
// that already has the required files uploaded with the right metadata:
//
//   * rfa file:      metadata.role = "rfa"
//   * companion:     metadata.role = "proposal"  (default modes)
//                    metadata.role = "aims"      (mode=aims)
//
// File uploads carry metadata via multipart fields alongside the `file`
// part — see `npm run file-upload` for the underlying call.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface GrantReviewOptions {
  base_url: string;
  chat_id: string;
  mode: string;
  username: string;
  password: string;
}

interface GrantReviewResult {
  message: string[];
}

export async function grant_review(
    opts: GrantReviewOptions): Promise<GrantReviewResult> {
  // 1. Login. The response sets a signed `session` cookie that gated routes
  //    (including /applications/grant_review) require on subsequent requests.
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

  // 2. POST the chat id with the mode query param. The handler validates
  //    that the chat belongs to the user (404 otherwise), looks up the rfa
  //    and companion files by `metadata.role`, reads their text content
  //    (parsed text for parsed files, raw bytes for plain-text uploads),
  //    generates the review, and records it as an ASSISTANT chat message.
  //    Response: `{ message: string[] }` — the review's text blocks.
  const review_res = await fetch(
    `${opts.base_url}/api/applications/grant_review`
      + `?mode=${encodeURIComponent(opts.mode)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: session_cookie,
      },
      body: JSON.stringify({ chat_id: opts.chat_id }),
    });
  const body = await review_res.text();
  if (review_res.status !== 200) {
    throw new Error(
      `Grant review failed (HTTP ${review_res.status}): ${body}`);
  }
  return JSON.parse(body) as GrantReviewResult;
}

// CLI driver — when run via `npm run grant-review`, exercise the function
// against a live server and print the response. Throws on any failure, which
// surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const chat_id = process.argv[2];
  if (!chat_id) {
    console.error("Usage: grant-review <chat-id> [mode] [base-url]");
    process.exit(2);
  }
  const result = await grant_review({
    base_url: process.argv[4] ?? "https://localhost",
    chat_id,
    mode: process.argv[3] ?? "standard",
    username: process.env.USERNAME ?? "testuser",
    password: process.env.PASSWORD ?? "irrelevant",
  });
  console.log(JSON.stringify(result, null, 2));
}
