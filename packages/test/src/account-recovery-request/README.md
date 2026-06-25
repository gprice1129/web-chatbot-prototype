# account-recovery-request

End-to-end check that `POST /api/account/recovery` behaves correctly. Issues
four requests and asserts:

- a well-formed **registered** email (`test@example.com`, seeded under
  `APP_ENV=test`) → `200` with a generic `{ message }`;
- a well-formed **unregistered** email → the **same** `200`, so a caller cannot
  tell registered from unknown addresses (the endpoint always returns `200` on a
  valid request);
- an invalid email format → `400` (validation);
- an email over `ACCOUNT_EMAIL_MAX_LENGTH` → `400` (validation).

## Prerequisites

- Webserver running and reachable (default `http://localhost:8080`).
- Started with `APP_ENV=test` so `test@example.com` is seeded (or pass a known
  registered address via `REGISTERED_EMAIL`).
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run account-recovery-request -- [base-url]
```

`base-url` defaults to `http://localhost:8080`. Pass a full URL (e.g. `https://localhost`) to target a TLS frontend.

## Rate-limit interaction

The four requests count against the per-IP account rate limit (default
`5 / 15 minutes`, a bucket separate from `/login`), so run this on a reasonably
fresh window. If the window is already partly consumed the test reports a clear
`429` error rather than a confusing status mismatch — wait out
`RATE_LIMIT_ACCOUNT_WINDOW`, restart the server, or raise
`RATE_LIMIT_ACCOUNT_MAX`.

## Env overrides

| Var                       | Default            | Notes                                   |
| ------------------------- | ------------------ | --------------------------------------- |
| `ACCOUNT_EMAIL_MAX_LENGTH`| `255`              | Must match the server's configured cap. |
| `REGISTERED_EMAIL`        | `test@example.com` | A known-registered address to probe.    |
