# project-chat-remove

End-to-end exercise of `DELETE /api/projects/:project_id/chats/:chat_id`. Logs in as `testuser`, removes the given chat from the given project, and prints the `{ message }` response. Removing a chat that is not a member returns 404.

## Prerequisites

- Webserver running and reachable (default `http://localhost:8080`).
- Server started with `AUTH_MODE=mock`, which seeds `testuser` and configures the mock auth service to ignore the password.
- `<project-id>` must belong to `testuser` and `<chat-id>` must currently be a member of it — typically set up via `npm run project-chat-add`.
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run project-chat-remove -- <project-id> <chat-id> [base-url]
```

`base-url` defaults to `http://localhost:8080`. Pass a full URL (e.g. `https://localhost`) to target a TLS frontend.

## Env overrides

| Var        | Default      | Notes                                                            |
| ---------- | ------------ | ---------------------------------------------------------------- |
| `TEST_USERNAME` | `testuser`   | Seeded automatically when the server runs with `AUTH_MODE=mock`.   |
| `TEST_PASSWORD` | `irrelevant` | The test auth service ignores the password for the seeded user. |
