# file-status

End-to-end exercise of `GET /api/chats/:chat_id/files/status/:file_id`. Logs in as `testuser`, fetches the parse status for a single file under a chat the user owns, and prints the `{ id, status }` response.

`status` is one of `uploaded`, `queued`, `parsed`, or `parse_failed`.

## Prerequisites

- Webserver running and reachable (default `https://localhost`).
- Server started with `APP_ENV=test`, which seeds `testuser` and configures the testing auth service to ignore the password.
- A chat id owned by `testuser` — typically obtained from a prior `npm run chat-create` run.
- A file id owned by `testuser` — typically obtained from a prior `npm run file-upload` run.
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run file-status -- <chat-id> <file-id> [base-url]
```

`base-url` defaults to `https://localhost`.

## Env overrides

| Var        | Default      | Notes                                                            |
| ---------- | ------------ | ---------------------------------------------------------------- |
| `USERNAME` | `testuser`   | Seeded automatically when the server runs with `APP_ENV=test`.   |
| `PASSWORD` | `irrelevant` | The test auth service ignores the password for the seeded user. |
