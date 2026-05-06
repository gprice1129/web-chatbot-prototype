# applications

End-to-end exercise of `GET /api/applications`. Logs in as `testuser`, fetches the list of enabled applications, and prints the `{ applications: [{ id, name, description? }] }` response.

The list is ordered by `created_at`. `description` is omitted when null.

## Prerequisites

- Webserver running and reachable (default `https://localhost`).
- Server started with `APP_ENV=test`, which seeds `testuser` and configures the testing auth service to ignore the password.
- The `applications` table is seeded — see `config/db/seed/`. With a fresh database the seed runs automatically during postgres init.
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run applications -- [base-url]
```

`base-url` defaults to `https://localhost`.

## Env overrides

| Var        | Default      | Notes                                                            |
| ---------- | ------------ | ---------------------------------------------------------------- |
| `USERNAME` | `testuser`   | Seeded automatically when the server runs with `APP_ENV=test`.   |
| `PASSWORD` | `irrelevant` | The test auth service ignores the password for the seeded user. |
