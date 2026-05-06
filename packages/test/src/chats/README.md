# chats

End-to-end exercise of `POST /api/chats?application_id=<uuid>`. Logs in as `testuser`, creates a new chat scoped to the given application, and prints the `{ id }` response.

A 400 with `application_id is unknown or disabled` means the supplied id is not present in the `applications` table or has `enabled = false`.

## Prerequisites

- Webserver running and reachable (default `https://localhost`).
- Server started with `APP_ENV=test`, which seeds `testuser` and configures the testing auth service to ignore the password.
- The `applications` table is seeded — see `config/db/seed/`. Use `npm run applications` to list available ids.
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run chats -- <application-id> [base-url]
```

`base-url` defaults to `https://localhost`.

## Env overrides

| Var        | Default      | Notes                                                            |
| ---------- | ------------ | ---------------------------------------------------------------- |
| `USERNAME` | `testuser`   | Seeded automatically when the server runs with `APP_ENV=test`.   |
| `PASSWORD` | `irrelevant` | The test auth service ignores the password for the seeded user. |
