# chat-delete

End-to-end exercise of `DELETE /api/chats/:chat_id`. Logs in as `testuser`, deletes the chat, and prints the `{ message }` response. The delete cascades in the database to the chat's messages and its file/project link rows.

## Prerequisites

- Webserver running and reachable (default `http://localhost:8080`).
- Server started with `APP_ENV=test`, which seeds `testuser` and configures the testing auth service to ignore the password.
- A chat id owned by `testuser` — typically obtained from a prior `npm run chat-create` run.
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run chat-delete -- <chat-id> [base-url]
```

`base-url` defaults to `http://localhost:8080`. Pass a full URL (e.g. `https://localhost`) to target a TLS frontend.

## Env overrides

| Var        | Default      | Notes                                                            |
| ---------- | ------------ | ---------------------------------------------------------------- |
| `TEST_USERNAME` | `testuser`   | Seeded automatically when the server runs with `APP_ENV=test`.   |
| `TEST_PASSWORD` | `irrelevant` | The test auth service ignores the password for the seeded user. |
