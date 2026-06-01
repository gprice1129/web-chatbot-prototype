# project-chats-get

End-to-end exercise of `GET /api/projects/:project_id/chats`. Logs in as `testuser` and prints the `{ chats: [...] }` response (the chats that are members of the project).

## Prerequisites

- Webserver running and reachable (default `https://localhost`).
- Server started with `APP_ENV=test`, which seeds `testuser` and configures the testing auth service to ignore the password.
- `<project-id>` must be a project owned by `testuser` — typically obtained from `npm run project-create`.
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run project-chats-get -- <project-id> [base-url]
```

`base-url` defaults to `https://localhost`.

## Env overrides

| Var        | Default      | Notes                                                            |
| ---------- | ------------ | ---------------------------------------------------------------- |
| `USERNAME` | `testuser`   | Seeded automatically when the server runs with `APP_ENV=test`.   |
| `PASSWORD` | `irrelevant` | The test auth service ignores the password for the seeded user. |
