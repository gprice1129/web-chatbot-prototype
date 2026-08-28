# login-rate-limit

End-to-end check that the rate limit on `POST /api/login` is enforced. Fires
login attempts in a burst until the server replies `429`, then asserts the
limiter behaved correctly:

- a `429` eventually appears (the limit is on, not disabled);
- the server allowed no more attempts than its advertised `x-ratelimit-limit`;
- the `429` carries a `Retry-After` header;
- the limiter stays closed for the rest of the window (the next call is `429`).

The limit applies *before* credentials are checked and is keyed by client IP,
so the test does not depend on the auth outcome — both `200` (under
`AUTH_MODE=mock`) and `401` count as an attempt that reached the limiter.

## Prerequisites

- Webserver running and reachable (default `http://localhost:8080`).
- Started with `AUTH_MODE=mock` so `testuser` is seeded (any password is accepted).
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run login-rate-limit -- [base-url] [--check-reset]
```

`base-url` defaults to `http://localhost:8080`. Pass a full URL (e.g. `https://localhost`) to target a TLS frontend.

With `--check-reset` (or `CHECK_RESET=1`) the test additionally waits out
`Retry-After` and confirms login is accepted again once the window rolls over —
this adds a real-time wait (≈ the window length).

## Re-running

The limit is per time window, so a recent run may have already consumed part of
the current window. The test still passes (the cap is enforced regardless) but
reports `"fresh_window": false`. For an exact full-allowance observation, run
against a freshly reset window (wait out the window or restart the server).

## Env overrides

| Var                    | Default      | Notes                                                                  |
| ---------------------- | ------------ | ---------------------------------------------------------------------- |
| `TEST_USERNAME`             | `testuser`   | Seeded automatically when the server runs with `AUTH_MODE=mock`.         |
| `TEST_PASSWORD`             | `irrelevant` | The test auth service ignores the password for the seeded user.        |
| `RATE_LIMIT_LOGIN_MAX` | _unset_      | If set, sizes the burst to `max*2 + 2`. The server's actual cap is read from `x-ratelimit-limit`. |
| `MAX_ATTEMPTS`         | `12`         | Hard cap on attempts fired while looking for a `429`. Raise it if the configured max is large. |
| `CHECK_RESET`          | _unset_      | Set to `1` to also verify the window reopens after `Retry-After`.      |
