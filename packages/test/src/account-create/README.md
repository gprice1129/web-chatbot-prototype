# account-create

End-to-end check that `POST /api/account` behaves correctly. Issues four
requests and asserts:

- a valid, unique account is accepted → `200` with a generic `{ message }`;
- re-submitting the **same** username/email also returns `200` — the endpoint is
  enumeration-resistant and never reveals a conflict via a `409` or a different
  body;
- an invalid email format → `400` (validation);
- a password under `ACCOUNT_PASSWORD_MIN_LENGTH` → `400` (validation).

The schema also enforces username min/max and email/password max via the same
mechanism; this test exercises a representative subset to stay within the
account rate-limit window.

## Prerequisites

- Webserver running and reachable (default `http://localhost:8080`).
- A disposable/test database — the success path writes a real user row, and each
  run creates a new one (the username/email carry a unique suffix).
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run account-create -- [base-url]
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

The caps are configurable on the server; this test reads the **same** env var
(defaulting to the compose default) so pointing it at the same `.env` keeps the
two in agreement.

| Var                          | Default | Notes                                   |
| ---------------------------- | ------- | --------------------------------------- |
| `ACCOUNT_PASSWORD_MIN_LENGTH`| `8`     | Must match the server's configured cap. |
