# project-chat-add

End-to-end exercise of `POST /api/projects/:project_id/chats`. Logs in as `testuser`, adds the given chat to the given project, and prints the `{ message }` response. Adding an already-linked chat is idempotent.

## Prerequisites

- Webserver running and reachable (default `http://localhost:8080`).
- Server started with `APP_ENV=test`, which seeds `testuser` and configures the testing auth service to ignore the password.
- `<project-id>` and `<chat-id>` must both belong to `testuser` — typically obtained from `npm run project-create` and `npm run chat-create`.
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run project-chat-add -- <project-id> <chat-id> [base-url]
```

`base-url` defaults to `http://localhost:8080`. Pass a full URL (e.g. `https://localhost`) to target a TLS frontend.

## Env overrides

| Var        | Default      | Notes                                                            |
| ---------- | ------------ | ---------------------------------------------------------------- |
| `TEST_USERNAME` | `testuser`   | Seeded automatically when the server runs with `APP_ENV=test`.   |
| `TEST_PASSWORD` | `irrelevant` | The test auth service ignores the password for the seeded user. |
