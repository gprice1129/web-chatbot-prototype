// Standalone example/test for the input limits on POST /api/login.
//
// Reading this file shows how the login caps behave; running it against a live
// server asserts they are actually enforced:
//
//   npm run login-limits -- [base-url]
//
// What it checks, in four login attempts:
//   * a within-limits credential is NOT rejected by the caps — it reaches the
//     auth check (200 under APP_ENV=test, or 401 otherwise),
//   * a username one char over the cap is rejected by validation (400),
//   * a password one char over the cap is rejected by validation (400),
//   * a request body larger than the body limit is rejected during parsing,
//     before validation (413).
//
// The caps are configurable on the server (LOGIN_USERNAME_MAX_LENGTH,
// LOGIN_PASSWORD_MAX_LENGTH, LOGIN_BODY_LIMIT). This test reads the same env
// vars (defaulting to the compose defaults 64 / 256 / 4096), so pointing it at
// the same .env as the server keeps them in agreement.
//
// Note: the four attempts count against the per-IP login rate limit (default
// 5/min). Run on a reasonably fresh window; a 429 is reported with guidance.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface LoginLimitsOptions {
  base_url: string;
  username_max_length: number;
  password_max_length: number;
  body_limit: number; // bytes
}

interface LoginLimitsResult {
  within_limits_status: number; // 200 or 401
  over_username_status: number; // 400
  over_password_status: number; // 400
  over_body_status: number;     // 413
}

async function _login(base_url: string, username: string, password: string): Promise<Response> {
  const res = await fetch(`${base_url}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  await res.text(); // drain the body so the socket is released
  return res;
}

// A 429 means the per-IP login rate-limit window was already (partly) consumed
// by earlier attempts — surface that clearly instead of as a confusing
// "expected 400, got 429" mismatch.
function _reject_if_rate_limited(res: Response, label: string): void {
  if (res.status === 429) {
    throw new Error(
      `Got 429 on "${label}": the login rate-limit window is partially consumed. ` +
      `This test issues 4 login attempts; run it on a fresh window (wait out ` +
      `RATE_LIMIT_LOGIN_WINDOW or restart the server) or raise RATE_LIMIT_LOGIN_MAX.`);
  }
}

export async function login_limits(opts: LoginLimitsOptions): Promise<LoginLimitsResult> {
  // The over-password case must stay under the body limit, otherwise it would
  // trip the body limit (413) before field validation (400) and the two checks
  // could not be told apart. With the defaults (256 vs 4096) there is plenty of
  // headroom; guard against a misconfiguration that collapses them.
  if (opts.password_max_length + 100 >= opts.body_limit) {
    throw new Error(
      `Cannot isolate the password cap from the body limit: ` +
      `LOGIN_PASSWORD_MAX_LENGTH (${opts.password_max_length}) is too close to ` +
      `LOGIN_BODY_LIMIT (${opts.body_limit}). Raise the body limit or lower the password cap.`);
  }

  // 1. A within-limits credential must NOT be rejected by the caps; it should
  //    reach the auth check (200 under APP_ENV=test, 401 under real auth).
  const within = await _login(opts.base_url, "testuser", "within-limits-password");
  _reject_if_rate_limited(within, "within-limits login");
  if (within.status !== 200 && within.status !== 401) {
    throw new Error(
      `within-limits login: expected 200 or 401 (reached the handler), got ${within.status}`);
  }

  // 2. Username one char over the cap → 400 from validation, before auth.
  const long_user = "u".repeat(opts.username_max_length + 1);
  const over_user = await _login(opts.base_url, long_user, "p");
  _reject_if_rate_limited(over_user, "over-length username");
  if (over_user.status !== 400) {
    throw new Error(
      `over-length username (${long_user.length} chars, cap ${opts.username_max_length}): ` +
      `expected 400, got ${over_user.status}`);
  }

  // 3. Password one char over the cap (body still small) → 400 from validation.
  const long_pass = "p".repeat(opts.password_max_length + 1);
  const over_pass = await _login(opts.base_url, "testuser", long_pass);
  _reject_if_rate_limited(over_pass, "over-length password");
  if (over_pass.status !== 400) {
    throw new Error(
      `over-length password (${long_pass.length} chars, cap ${opts.password_max_length}): ` +
      `expected 400, got ${over_pass.status}`);
  }

  // 4. A body larger than the body limit → 413 during parsing, before validation.
  const huge_pass = "x".repeat(opts.body_limit + 1024);
  const over_body = await _login(opts.base_url, "testuser", huge_pass);
  _reject_if_rate_limited(over_body, "over-bodyLimit request");
  if (over_body.status !== 413) {
    throw new Error(
      `over-bodyLimit body (~${huge_pass.length} bytes, limit ${opts.body_limit}): ` +
      `expected 413, got ${over_body.status}`);
  }

  return {
    within_limits_status: within.status,
    over_username_status: over_user.status,
    over_password_status: over_pass.status,
    over_body_status: over_body.status,
  };
}

// CLI driver — when run via `npm run login-limits`, exercise the function
// against a live server and print the result. Throws on any failure, which
// surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const base_url = args.find((a) => !a.startsWith("--")) ?? "http://localhost:8080";

  // Read the caps from the same env vars that configure the server, defaulting
  // to the compose defaults so a plain run "just works" against a default stack.
  const env_int = (name: string, def: number): number => {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "") return def;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`${name} must be a positive integer, got "${raw}"`);
    }
    return n;
  };

  const result = await login_limits({
    base_url,
    username_max_length: env_int("LOGIN_USERNAME_MAX_LENGTH", 64),
    password_max_length: env_int("LOGIN_PASSWORD_MAX_LENGTH", 256),
    body_limit: env_int("LOGIN_BODY_LIMIT", 4096),
  });

  console.log(JSON.stringify(result, null, 2));
  console.log("PASS: login input limits are enforced (over-length -> 400, oversized body -> 413).");
}
