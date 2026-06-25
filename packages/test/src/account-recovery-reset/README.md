# account-recovery-reset

End-to-end check that `POST /api/account/recovery/reset` rejects bad input. A
successful reset needs a real token delivered out-of-band (email / server log),
so this test covers the rejection paths observable over HTTP. Issues four
requests and asserts:

- a syntactically-valid but **unknown** token → `400` — it passes validation and
  reaches the handler, which rejects it with the same generic "invalid or
  expired" error it gives for any bad token (no reason leaked);
- an empty token → `400` (validation: `token` has `minLength` 1);
- a password under `ACCOUNT_PASSWORD_MIN_LENGTH` → `400` (validation);
- a password over `ACCOUNT_PASSWORD_MAX_LENGTH` → `400` (validation).

## Prerequisites

- Webserver running and reachable (default `http://localhost:8080`).
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run account-recovery-reset -- [base-url]
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

The caps are configurable on the server; this test reads the **same** env vars
(defaulting to the compose defaults) so pointing it at the same `.env` keeps the
two in agreement.

| Var                          | Default | Notes                                   |
| ---------------------------- | ------- | --------------------------------------- |
| `ACCOUNT_PASSWORD_MIN_LENGTH`| `8`     | Must match the server's configured cap. |
| `ACCOUNT_PASSWORD_MAX_LENGTH`| `128`   | Must match the server's configured cap. |
