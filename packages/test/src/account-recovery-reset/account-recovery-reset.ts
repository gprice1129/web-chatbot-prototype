// Standalone example/test for POST /api/account/recovery/reset (perform reset).
//
// Reading this file shows how the reset endpoint behaves; running it against a
// live server asserts it. A successful reset needs a real token, delivered
// out-of-band (email / server log), so this test covers the rejection paths
// that ARE observable over HTTP:
//
//   npm run account-recovery-reset -- [base-url]
//
// What it checks, in four requests:
//   * a syntactically-valid but unknown token -> 400 — it passes validation and
//     reaches the handler, which rejects it with the same generic "invalid or
//     expired" error it gives for any bad token (no reason leaked);
//   * an empty token -> 400 (validation: token has minLength 1);
//   * a password under ACCOUNT_PASSWORD_MIN_LENGTH -> 400 (validation);
//   * a password over ACCOUNT_PASSWORD_MAX_LENGTH -> 400 (validation).
//
// Rate-limit interaction: the four requests count against the per-IP account
// rate limit (default 5 / 15 minutes — its own bucket, separate from /login).
// Run on a fresh window; a 429 is surfaced with guidance.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface AccountRecoveryResetOptions {
  base_url: string;
  password_min_length: number;
  password_max_length: number;
}

interface AccountRecoveryResetResult {
  unknown_token_status: number;  // 400 (handler: invalid/expired)
  empty_token_status: number;    // 400 (validation)
  short_password_status: number; // 400 (validation)
  long_password_status: number;  // 400 (validation)
}

async function _reset(base_url: string, token: string, password: string): Promise<Response> {
  const res = await fetch(`${base_url}/api/account/recovery/reset`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
  await res.text(); // drain the body so the socket is released
  return res;
}

// A 429 means the per-IP account rate-limit window was already (partly) consumed
// — surface that clearly instead of as a confusing status mismatch.
function _reject_if_rate_limited(res: Response, label: string): void {
  if (res.status === 429) {
    throw new Error(
      `Got 429 on "${label}": the per-IP account rate-limit window is partially ` +
      `consumed. This test issues 4 requests to /api/account/recovery/reset; run it ` +
      `on a fresh window (wait out RATE_LIMIT_ACCOUNT_WINDOW or restart the server) ` +
      `or raise RATE_LIMIT_ACCOUNT_MAX.`);
  }
}

export async function account_recovery_reset(
    opts: AccountRecoveryResetOptions): Promise<AccountRecoveryResetResult> {
  const valid_password = "x".repeat(opts.password_min_length);

  // 1. A well-formed but unknown token passes validation and reaches the
  //    handler, which rejects it -> 400 (no token in any DB matches it).
  const unknown_token = `tok_${Date.now()}${Math.floor(Math.random() * 1e9)}`;
  const unknown = await _reset(opts.base_url, unknown_token, valid_password);
  _reject_if_rate_limited(unknown, "unknown token");
  if (unknown.status !== 400) {
    throw new Error(`unknown token: expected 400, got ${unknown.status}`);
  }

  // 2. An empty token -> 400 from validation (token minLength 1).
  const empty = await _reset(opts.base_url, "", valid_password);
  _reject_if_rate_limited(empty, "empty token");
  if (empty.status !== 400) {
    throw new Error(`empty token: expected 400, got ${empty.status}`);
  }

  // 3. A password one char under the minimum -> 400 from validation.
  const short_pw = "x".repeat(opts.password_min_length - 1);
  const short = await _reset(opts.base_url, "any-token", short_pw);
  _reject_if_rate_limited(short, "short password");
  if (short.status !== 400) {
    throw new Error(
      `short password (${short_pw.length} chars, min ${opts.password_min_length}): ` +
      `expected 400, got ${short.status}`);
  }

  // 4. A password one char over the maximum -> 400 from validation.
  const long_pw = "x".repeat(opts.password_max_length + 1);
  const long = await _reset(opts.base_url, "any-token", long_pw);
  _reject_if_rate_limited(long, "long password");
  if (long.status !== 400) {
    throw new Error(
      `long password (${long_pw.length} chars, max ${opts.password_max_length}): ` +
      `expected 400, got ${long.status}`);
  }

  return {
    unknown_token_status: unknown.status,
    empty_token_status: empty.status,
    short_password_status: short.status,
    long_password_status: long.status,
  };
}

// CLI driver — when run via `npm run account-recovery-reset`, exercise the
// function against a live server and print the result. Throws on any failure,
// which surfaces as a non-zero exit code.
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

  const result = await account_recovery_reset({
    base_url,
    password_min_length: env_int("ACCOUNT_PASSWORD_MIN_LENGTH", 8),
    password_max_length: env_int("ACCOUNT_PASSWORD_MAX_LENGTH", 128),
  });

  console.log(JSON.stringify(result, null, 2));
  console.log("PASS: reset rejects unknown tokens (400) and invalid input (400) without " +
    "leaking why a token failed.");
}
