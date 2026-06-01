# project-chat-remove

End-to-end exercise of `DELETE /api/projects/:project_id/chats/:chat_id`. Logs in as `testuser`, removes the given chat from the given project, and prints the `{ message }` response. Removing a chat that is not a member returns 404.

## Prerequisites

- Webserver running and reachable (default `https://localhost`).
- Server started with `APP_ENV=test`, which seeds `testuser` and configures the testing auth service to ignore the password.
- `<project-id>` must belong to `testuser` and `<chat-id>` must currently be a member of it — typically set up via `npm run project-chat-add`.
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run project-chat-remove -- <project-id> <chat-id> [base-url]
```

`base-url` defaults to `https://localhost`.

## Env overrides

| Var        | Default      | Notes                                                            |
| ---------- | ------------ | ---------------------------------------------------------------- |
| `USERNAME` | `testuser`   | Seeded automatically when the server runs with `APP_ENV=test`.   |
| `PASSWORD` | `irrelevant` | The test auth service ignores the password for the seeded user. |
