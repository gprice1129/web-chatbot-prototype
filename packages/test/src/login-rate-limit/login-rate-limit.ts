// Standalone example/test for the rate limit on POST /api/login.
//
// Reading this file shows how the login limiter behaves; running it against a
// live server asserts that it is actually enforced:
//
//   npm run login-rate-limit -- [base-url] [--check-reset]
//
// What it does: fires login attempts in a burst until the server starts
// replying 429, then checks the limiter behaved correctly:
//   * a 429 eventually appears (the limit is enforced, not disabled),
//   * the server never allowed more attempts than `x-ratelimit-limit`,
//   * the 429 carries a Retry-After header,
//   * the limiter stays closed for the rest of the window (next call is 429).
// With --check-reset it additionally waits out Retry-After and confirms login
// is accepted again once the window rolls over.
//
// The limiter is keyed by client IP and the limit applies BEFORE credentials
// are checked, so this test does not depend on the auth outcome — both 200
// (APP_ENV=test seeds `testuser`) and 401 count as "attempt reached the
// limiter". Anything else (e.g. 500) fails the test.
//
// Re-runnable: because the limit is per-window, a recent run may have already
// consumed part (or all) of the current window. The test still passes in that
// case (the cap is enforced either way) but reports `fresh_window: false`. For
// an exact full-allowance observation, run against a freshly reset window
// (wait out the window, restart the server, or pass --check-reset).

// Match `curl -k` for the local self-signed cert. Set before any fetch so
// undici picks it up when the global dispatcher is created.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

interface LoginRateLimitOptions {
  base_url: string;
  username: string;
  password: string;
  // Safety cap on how many attempts to fire before giving up looking for a 429.
  // Should exceed the server's configured max; defaults are derived in the CLI.
  max_attempts: number;
  // Also verify the window reopens after Retry-After (adds a real-time wait).
  check_reset: boolean;
}

interface LoginRateLimitResult {
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

async function _attempt_login(opts: LoginRateLimitOptions): Promise<Response> {
  const res = await fetch(`${opts.base_url}/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: opts.username, password: opts.password }),
  });
  await res.text(); // drain the body so the socket is released
  return res;
}

export async function login_rate_limit(
    opts: LoginRateLimitOptions): Promise<LoginRateLimitResult> {
  let configured_max: number | null = null;
  let allowed_before_block = 0;
  let blocked: Response | null = null;

  // 1. Burst login attempts until the limiter trips (or we hit the safety cap).
  for (let i = 0; i < opts.max_attempts; i++) {
    const res = await _attempt_login(opts);

    const limit_header = res.headers.get("x-ratelimit-limit");
    if (limit_header !== null && configured_max === null) {
      configured_max = Number(limit_header);
    }

    if (res.status === 429) {
      blocked = res;
      break;
    }
    if (res.status !== 200 && res.status !== 401) {
      throw new Error(
        `Unexpected status ${res.status} from /api/login before the limiter tripped`);
    }
    allowed_before_block++;
  }

  // 2. A 429 must have appeared — otherwise the limiter is off or its max is
  //    higher than we probed.
  if (blocked === null) {
    throw new Error(
      `Rate limiting not enforced: ${allowed_before_block} login attempts in a ` +
      `row were never blocked (probed ${opts.max_attempts}). If the configured ` +
      `max is >= ${opts.max_attempts}, raise it via RATE_LIMIT_LOGIN_MAX or MAX_ATTEMPTS.`);
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
  const sticky = await _attempt_login(opts);
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
    const after = await _attempt_login(opts);
    if (after.status === 429) {
      throw new Error(
        `Login still rate-limited after waiting ${wait_s}s for the window to reset`);
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

// CLI driver — when run via `npm run login-rate-limit`, exercise the function
// against a live server and print the result. Throws on any failure, which
// surfaces as a non-zero exit code.
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const base_url = args.find((a) => !a.startsWith("--")) ?? "https://localhost";
  const check_reset = process.env.CHECK_RESET === "1" || args.includes("--check-reset");

  // Size the burst so it comfortably exceeds the server's max. Prefer an
  // explicit MAX_ATTEMPTS; else derive from the known RATE_LIMIT_LOGIN_MAX;
  // else fall back to a sane default.
  const configured = Number(process.env.RATE_LIMIT_LOGIN_MAX);
  const max_attempts = Number(process.env.MAX_ATTEMPTS)
    || (Number.isInteger(configured) && configured > 0 ? configured * 2 + 2 : 12);

  const result = await login_rate_limit({
    base_url,
    username: process.env.USERNAME ?? "testuser",
    password: process.env.PASSWORD ?? "irrelevant",
    max_attempts,
    check_reset,
  });

  console.log(JSON.stringify(result, null, 2));
  if (!result.fresh_window) {
    console.warn(
      "NOTE: did not observe a full fresh-window allowance (a recent run likely " +
      "consumed part of the window). The cap was still enforced. For an exact " +
      "allowance check, wait for the window to reset and re-run.");
  }
  console.log("PASS: login rate limiting is enforced.");
}
