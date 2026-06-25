// Standalone example/test for the per-IP rate limit on the account endpoints,
// probed via POST /api/account/recovery.
//
// Reading this file shows how the account limiter behaves; running it against a
// live server asserts that it is actually enforced:
//
//   npm run account-rate-limit -- [base-url] [--check-reset]
//
// What it does: fires recovery requests in a burst until the server starts
// replying 429, then checks the limiter behaved correctly:
//   * a 429 eventually appears (the limit is enforced, not disabled),
//   * the server never allowed more attempts than `x-ratelimit-limit`,
//   * the 429 carries a Retry-After header,
//   * the limiter stays closed for the rest of the window (next call is 429).
// With --check-reset it additionally waits out Retry-After and confirms the
// endpoint is accepted again once the window rolls over.
//
// Why /api/account/recovery: the limiter is keyed by client IP and runs BEFORE
// the handler, so the test does not depend on the handler's outcome. This route
// is side-effect-free for an unregistered email (no DB write, no mail) and
// always returns 200 on a valid request, so every pre-limit attempt cleanly
// "reaches the limiter". Each account route has its OWN per-route bucket, so
// this measures the account limit specifically (separate from /login).
//
// Re-runnable: because the limit is per-window, a recent run may have already
// consumed part (or all) of the current window. The test still passes in that
// case (the cap is enforced either way) but reports `fresh_window: false`. NOTE
// the account window defaults to 15 minutes (vs 1 minute for login), so a fresh
// observation needs a recently-(re)started server, and --check-reset waits out
// the full Retry-After.

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface AccountRateLimitOptions {
  base_url: string;
  // A well-formed email to probe with. Keyed by IP, so the value is irrelevant
  // to the limiter; an unregistered address keeps the probe side-effect-free.
  email: string;
  // Safety cap on how many attempts to fire before giving up looking for a 429.
  // Should exceed the server's configured max; defaults are derived in the CLI.
  max_attempts: number;
  // Also verify the window reopens after Retry-After (adds a real-time wait).
  check_reset: boolean;
}

interface AccountRateLimitResult {
  // The server's configured max, read from the x-ratelimit-limit header.
  configured_max: number | null;
  // Non-429 responses observed before the first 429.
  allowed_before_block: number;
  retry_after_seconds: number;
  // True when we saw a full, untouched allowance (allowed == configured max).
  fresh_window: boolean;
  // null when --check-reset was not requested.
  reset_verified: boolean | null;
}

async function _attempt_recovery(opts: AccountRateLimitOptions): Promise<Response> {
  const res = await fetch(`${opts.base_url}/api/account/recovery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: opts.email }),
  });
  await res.text(); // drain the body so the socket is released
  return res;
}

export async function account_rate_limit(
    opts: AccountRateLimitOptions): Promise<AccountRateLimitResult> {
  let configured_max: number | null = null;
  let allowed_before_block = 0;
  let blocked: Response | null = null;

  // 1. Burst recovery requests until the limiter trips (or we hit the safety cap).
  for (let i = 0; i < opts.max_attempts; i++) {
    const res = await _attempt_recovery(opts);

    const limit_header = res.headers.get("x-ratelimit-limit");
    if (limit_header !== null && configured_max === null) {
      configured_max = Number(limit_header);
    }

    if (res.status === 429) {
      blocked = res;
      break;
    }
    // A valid recovery request always returns 200 (registered or not); anything
    // else before the limiter trips is a real failure.
    if (res.status !== 200) {
      throw new Error(
        `Unexpected status ${res.status} from /api/account/recovery before the limiter tripped`);
    }
    allowed_before_block++;
  }

  // 2. A 429 must have appeared — otherwise the limiter is off or its max is
  //    higher than we probed.
  if (blocked === null) {
    throw new Error(
      `Rate limiting not enforced: ${allowed_before_block} account requests in a ` +
      `row were never blocked (probed ${opts.max_attempts}). If the configured ` +
      `max is >= ${opts.max_attempts}, raise it via RATE_LIMIT_ACCOUNT_MAX or MAX_ATTEMPTS.`);
  }

  // 3. The 429 must tell the client when to retry.
  const retry_after_seconds = Number(blocked.headers.get("retry-after"));
  if (!Number.isFinite(retry_after_seconds) || retry_after_seconds <= 0) {
    throw new Error(
      `429 response missing a valid Retry-After header ` +
      `(got "${blocked.headers.get("retry-after")}")`);
  }

  // 4. The server must never have allowed more than its advertised cap.
  if (configured_max !== null && allowed_before_block > configured_max) {
    throw new Error(
      `Limiter allowed ${allowed_before_block} attempts but x-ratelimit-limit ` +
      `is ${configured_max}`);
  }

  // 5. The limiter must stay closed for the rest of the window.
  const sticky = await _attempt_recovery(opts);
  if (sticky.status !== 429) {
    throw new Error(
      `Expected continued 429 within the window, got ${sticky.status}`);
  }

  const fresh_window = configured_max !== null
    ? allowed_before_block === configured_max
    : allowed_before_block > 0;

  // 6. Optionally confirm the window reopens once Retry-After elapses.
  let reset_verified: boolean | null = null;
  if (opts.check_reset) {
    const wait_s = retry_after_seconds + 2;
    console.error(`Waiting ${wait_s}s for the rate-limit window to reset...`);
    await new Promise((resolve) => setTimeout(resolve, wait_s * 1000));
    const after = await _attempt_recovery(opts);
    if (after.status === 429) {
      throw new Error(
        `Account endpoint still rate-limited after waiting ${wait_s}s for the window to reset`);
    }
    reset_verified = true;
  }

  return {
    configured_max,
    allowed_before_block,
    retry_after_seconds,
    fresh_window,
    reset_verified,
  };
}

// CLI driver — when run via `npm run account-rate-limit`, exercise the function
// against a live server and print the result. Throws on any failure, which
// surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const base_url = args.find((a) => !a.startsWith("--")) ?? "http://localhost:8080";
  const check_reset = process.env.CHECK_RESET === "1" || args.includes("--check-reset");

  // Size the burst so it comfortably exceeds the server's max. Prefer an
  // explicit MAX_ATTEMPTS; else derive from the known RATE_LIMIT_ACCOUNT_MAX;
  // else fall back to a sane default.
  const configured = Number(process.env.RATE_LIMIT_ACCOUNT_MAX);
  const max_attempts = Number(process.env.MAX_ATTEMPTS)
    || (Number.isInteger(configured) && configured > 0 ? configured * 2 + 2 : 12);

  // An unregistered probe address keeps the burst side-effect-free (no token
  // set, no mail). The limiter is IP-keyed, so the value does not affect counting.
  const email = process.env.PROBE_EMAIL
    ?? `ratelimit_${Date.now()}${Math.floor(Math.random() * 1e6)}@example.com`;

  const result = await account_rate_limit({
    base_url,
    email,
    max_attempts,
    check_reset,
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.fresh_window) {
    console.warn(
      "NOTE: did not observe a full fresh-window allowance (a recent run likely " +
      "consumed part of the window). The cap was still enforced. For an exact " +
      "allowance check, wait for the window to reset (default 15m) or restart the server.");
  }
  console.log("PASS: account rate limiting is enforced.");
}
