# login-limits

End-to-end check that the input limits on `POST /api/login` are enforced. Issues
four login attempts and asserts:

- a within-limits credential is **not** rejected by the caps — it reaches the
  auth check (`200` under `AUTH_MODE=mock`, or `401` otherwise);
- a username one character over `LOGIN_USERNAME_MAX_LENGTH` → `400` (validation);
- a password one character over `LOGIN_PASSWORD_MAX_LENGTH` → `400` (validation);
- a request body larger than `LOGIN_BODY_LIMIT` → `413`, rejected during parsing
  before validation runs.

## Prerequisites

- Webserver running and reachable (default `http://localhost:8080`).
- Started with `AUTH_MODE=mock` so `testuser` is seeded (any password is accepted).
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run login-limits -- [base-url]
```

`base-url` defaults to `http://localhost:8080`. Pass a full URL (e.g. `https://localhost`) to target a TLS frontend.

## Rate-limit interaction

The four attempts count against the per-IP login rate limit (default `5/min`),
so run this on a reasonably fresh window. If the window is already partly
consumed the test reports a clear `429` error rather than a confusing status
mismatch — wait out `RATE_LIMIT_LOGIN_WINDOW`, restart the server, or raise
`RATE_LIMIT_LOGIN_MAX`.

## Env overrides

The caps are configurable on the server; this test reads the **same** env vars
(defaulting to the compose defaults) so pointing it at the same `.env` keeps the
two in agreement.

| Var                         | Default | Notes                                   |
| --------------------------- | ------- | --------------------------------------- |
| `LOGIN_USERNAME_MAX_LENGTH` | `64`    | Must match the server's configured cap. |
| `LOGIN_PASSWORD_MAX_LENGTH` | `256`   | Must match the server's configured cap. |
| `LOGIN_BODY_LIMIT`          | `4096`  | Must match the server's configured cap (bytes). |
