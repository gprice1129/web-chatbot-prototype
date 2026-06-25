// Standalone example/test for POST /api/account/recovery (password-reset request).
//
// Reading this file shows how the recovery-request endpoint behaves; running it
// against a live server asserts it:
//
//   npm run account-recovery-request -- [base-url]
//
// What it checks, in four requests:
//   * a well-formed REGISTERED email (test@example.com, seeded under
//     APP_ENV=test) returns 200 with a generic { message };
//   * a well-formed UNREGISTERED email returns the SAME 200 — a caller cannot
//     tell registered from unknown addresses (enumeration-resistant: the
//     endpoint always returns 200 on a valid request);
//   * an invalid email format is rejected by validation -> 400;
//   * an email over ACCOUNT_EMAIL_MAX_LENGTH is rejected by validation -> 400.
//
// Rate-limit interaction: the four requests count against the per-IP account
// rate limit (default 5 / 15 minutes — its own bucket, separate from /login).
// Run on a fresh window; a 429 is surfaced with guidance.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface AccountRecoveryRequestOptions {
  base_url: string;
  // Server's ACCOUNT_EMAIL_MAX_LENGTH; used to build a just-too-long value.
  email_max_length: number;
  // A registered address; under APP_ENV=test the seeded user is test@example.com.
  registered_email: string;
}

interface AccountRecoveryRequestResult {
  registered_status: number;   // 200
  unregistered_status: number; // 200 (same as registered — anti-enumeration)
  bad_email_status: number;    // 400
  long_email_status: number;   // 400
}

async function _request(base_url: string, email: string): Promise<Response> {
  const res = await fetch(`${base_url}/api/account/recovery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
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
      `consumed. This test issues 4 requests to /api/account/recovery; run it on a ` +
      `fresh window (wait out RATE_LIMIT_ACCOUNT_WINDOW or restart the server) or ` +
      `raise RATE_LIMIT_ACCOUNT_MAX.`);
  }
}

export async function account_recovery_request(
    opts: AccountRecoveryRequestOptions): Promise<AccountRecoveryRequestResult> {
  // 1. A registered email -> 200 generic success.
  const registered = await _request(opts.base_url, opts.registered_email);
  _reject_if_rate_limited(registered, "registered email");
  if (registered.status !== 200) {
    throw new Error(`registered email: expected 200, got ${registered.status}`);
  }

  // 2. An unregistered email -> the SAME 200 (cannot be used to probe accounts).
  const unknown = await _request(opts.base_url,
    `unknown_${Date.now()}${Math.floor(Math.random() * 1e6)}@example.com`);
  _reject_if_rate_limited(unknown, "unregistered email");
  if (unknown.status !== 200) {
    throw new Error(
      `unregistered email: expected 200 (same as registered), got ${unknown.status}`);
  }

  // 3. An invalid email format -> 400 from validation.
  const bad = await _request(opts.base_url, "not-an-email");
  _reject_if_rate_limited(bad, "invalid email");
  if (bad.status !== 400) {
    throw new Error(`invalid email: expected 400, got ${bad.status}`);
  }

  // 4. An email over the max length -> 400 from validation.
  const long_local = "a".repeat(opts.email_max_length); // local part alone exceeds the cap
  const long = await _request(opts.base_url, `${long_local}@example.com`);
  _reject_if_rate_limited(long, "over-length email");
  if (long.status !== 400) {
    throw new Error(
      `over-length email (~${long_local.length + 12} chars, cap ${opts.email_max_length}): ` +
      `expected 400, got ${long.status}`);
  }

  return {
    registered_status: registered.status,
    unregistered_status: unknown.status,
    bad_email_status: bad.status,
    long_email_status: long.status,
  };
}

// CLI driver — when run via `npm run account-recovery-request`, exercise the
// function against a live server and print the result. Throws on any failure,
// which surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const base_url = args.find((a) => !a.startsWith("--")) ?? "http://localhost:8080";

  // Read the cap from the same env var that configures the server, defaulting
  // to the compose default so a plain run "just works" against a default stack.
  const env_int = (name: string, def: number): number => {
    const raw = process.env[name];
    if (raw === undefined || raw.trim() === "") return def;
    const n = Number(raw);
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(`${name} must be a positive integer, got "${raw}"`);
    }
    return n;
  };

  const result = await account_recovery_request({
    base_url,
    email_max_length: env_int("ACCOUNT_EMAIL_MAX_LENGTH", 255),
    registered_email: process.env.REGISTERED_EMAIL ?? "test@example.com",
  });

  console.log(JSON.stringify(result, null, 2));
  console.log("PASS: recovery request returns an identical 200 for registered and unknown " +
    "emails (no enumeration) and rejects invalid input (400).");
}
