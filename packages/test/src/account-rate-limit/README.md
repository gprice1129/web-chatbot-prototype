# account-rate-limit

End-to-end check that the per-IP rate limit on the account endpoints is
enforced, probed via `POST /api/account/recovery`. Bursts requests until the
server replies `429`, then asserts:

- a `429` eventually appears (the limit is enforced, not disabled);
- the server never allowed more attempts than `x-ratelimit-limit`;
- the `429` carries a `Retry-After` header;
- the limiter stays closed for the rest of the window (the next call is `429`).

With `--check-reset` it additionally waits out `Retry-After` and confirms the
endpoint is accepted again once the window rolls over.

`/api/account/recovery` is used as the probe because it is side-effect-free for
an unregistered email (no DB write, no mail) and always returns `200` on a valid
request, so every pre-limit attempt cleanly reaches the limiter. Each account
route has its **own** per-route bucket, so this measures the account limit
specifically (separate from `/login`).

## Prerequisites

- Webserver running and reachable (default `http://localhost:8080`).
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run account-rate-limit -- [base-url] [--check-reset]
```

`base-url` defaults to `http://localhost:8080`. Pass a full URL (e.g. `https://localhost`) to target a TLS frontend.

## Fresh-window note

The account window defaults to **15 minutes** (vs 1 minute for login), so:

- a full fresh-window observation needs a recently-(re)started server — a recent
  run leaves `fresh_window: false` (the cap is still enforced either way);
- `--check-reset` waits out the full `Retry-After` (up to ~15 minutes), so use it
  only when you want to confirm the window actually reopens.

## Env overrides

| Var                     | Default              | Notes                                              |
| ----------------------- | -------------------- | -------------------------------------------------- |
| `RATE_LIMIT_ACCOUNT_MAX`| `5`                  | Sizes the burst; should match the server's cap.    |
| `MAX_ATTEMPTS`          | `MAX * 2 + 2`        | Explicit burst size, overrides the derived value.  |
| `PROBE_EMAIL`           | random unregistered  | Address to probe with (irrelevant to the limiter). |
| `CHECK_RESET`           | unset                | Set to `1` (or pass `--check-reset`) to verify reset. |
