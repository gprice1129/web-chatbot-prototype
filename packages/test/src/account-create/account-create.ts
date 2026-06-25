// Standalone example/test for POST /api/account (account creation).
//
// Reading this file shows how the create endpoint behaves; running it against a
// live server asserts it:
//
//   npm run account-create -- [base-url]
//
// What it checks, in four requests:
//   * a valid, unique account is accepted -> 200 with a generic { message };
//   * re-submitting the SAME username/email also returns 200 — the endpoint is
//     deliberately enumeration-resistant and never reveals a conflict via a 409
//     or a different body;
//   * an invalid email format is rejected by validation -> 400;
//   * a password under ACCOUNT_PASSWORD_MIN_LENGTH is rejected -> 400.
//
// The success path writes a real row, so each run creates a new user (the
// username/email carry a unique suffix) — point it at a disposable/test DB.
//
// Rate-limit interaction: the four requests count against the per-IP account
// rate limit (default 5 / 15 minutes — its own bucket, separate from /login).
// Run on a fresh window; a 429 is surfaced with guidance.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface AccountCreateOptions {
  base_url: string;
  // Server's ACCOUNT_PASSWORD_MIN_LENGTH; used to build a just-too-short value.
  password_min_length: number;
}

interface AccountCreateResult {
  created_status: number;        // 200
  duplicate_status: number;      // 200 (enumeration-resistant)
  bad_email_status: number;      // 400
  short_password_status: number; // 400
}

async function _create(base_url: string, body: unknown): Promise<Response> {
  const res = await fetch(`${base_url}/api/account`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
      `consumed. This test issues 4 requests to /api/account; run it on a fresh ` +
      `window (wait out RATE_LIMIT_ACCOUNT_WINDOW or restart the server) or raise ` +
      `RATE_LIMIT_ACCOUNT_MAX.`);
  }
}

export async function account_create(
    opts: AccountCreateOptions): Promise<AccountCreateResult> {
  // Unique identity so the success path does not collide with earlier runs.
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const username = `acct_${suffix}`;
  const email = `acct_${suffix}@example.com`;
  const password = "x".repeat(opts.password_min_length); // a valid-length password

  // 1. A valid, unique account is accepted -> 200 generic success.
  const created = await _create(opts.base_url, { username, email, password });
  _reject_if_rate_limited(created, "valid account create");
  if (created.status !== 200) {
    throw new Error(`valid account create: expected 200, got ${created.status}`);
  }

  // 2. The SAME username/email again -> still 200 (no 409, no enumeration).
  const dup = await _create(opts.base_url, { username, email, password });
  _reject_if_rate_limited(dup, "duplicate account create");
  if (dup.status !== 200) {
    throw new Error(
      `duplicate account create: expected 200 (enumeration-resistant), got ${dup.status}`);
  }

  // 3. An invalid email format -> 400 from validation.
  const bad_email = await _create(opts.base_url,
    { username: `${username}_b`, email: "not-an-email", password });
  _reject_if_rate_limited(bad_email, "invalid email");
  if (bad_email.status !== 400) {
    throw new Error(`invalid email: expected 400, got ${bad_email.status}`);
  }

  // 4. A password one char under the minimum -> 400 from validation.
  const short_pw = "x".repeat(opts.password_min_length - 1);
  const short = await _create(opts.base_url,
    { username: `${username}_c`, email: `c_${email}`, password: short_pw });
  _reject_if_rate_limited(short, "short password");
  if (short.status !== 400) {
    throw new Error(
      `short password (${short_pw.length} chars, min ${opts.password_min_length}): ` +
      `expected 400, got ${short.status}`);
  }

  return {
    created_status: created.status,
    duplicate_status: dup.status,
    bad_email_status: bad_email.status,
    short_password_status: short.status,
  };
}

// CLI driver — when run via `npm run account-create`, exercise the function
// against a live server and print the result. Throws on any failure, which
// surfaces as a non-zero exit code.
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

  const result = await account_create({
    base_url,
    password_min_length: env_int("ACCOUNT_PASSWORD_MIN_LENGTH", 8),
  });

  console.log(JSON.stringify(result, null, 2));
  console.log("PASS: account create accepts a valid body (200), is enumeration-resistant " +
    "on duplicates (200), and rejects invalid input (400).");
}
