# project-get

End-to-end exercise of `GET /api/projects`. Logs in as `testuser` and prints the `{ projects: [...] }` response (the caller's projects, newest first).

## Prerequisites

- Webserver running and reachable (default `https://localhost`).
- Server started with `APP_ENV=test`, which seeds `testuser` and configures the testing auth service to ignore the password.
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run project-get -- [base-url]
```

`base-url` defaults to `https://localhost`.

## Env overrides

| Var        | Default      | Notes                                                            |
| ---------- | ------------ | ---------------------------------------------------------------- |
| `USERNAME` | `testuser`   | Seeded automatically when the server runs with `APP_ENV=test`.   |
| `PASSWORD` | `irrelevant` | The test auth service ignores the password for the seeded user. |
