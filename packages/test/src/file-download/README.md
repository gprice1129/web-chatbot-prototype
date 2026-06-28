# file-download

End-to-end exercise of `GET /api/chats/:chat_id/files/download/:file_id`. Logs in as `testuser`, streams the response body to disk, and prints `{ output_path, bytes, mime_type }`.

The server-supplied filename is parsed from `content-disposition` (preferring the RFC 5987 `filename*` form so non-ASCII names round-trip).

## Prerequisites

- Webserver running and reachable (default `http://localhost:8080`).
- Server started with `APP_ENV=test`, which seeds `testuser` and configures the testing auth service to ignore the password.
- A chat id owned by `testuser` — typically obtained from a prior `npm run chat-create` run.
- A file id owned by `testuser` whose status is `parsed` (or at least whose bytes are still on disk) — typically obtained from a prior `npm run file-upload` run.
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run file-download -- <chat-id> <file-id> [base-url]
```

`base-url` defaults to `http://localhost:8080`. Pass a full URL (e.g. `https://localhost`) to target a TLS frontend.

## Env overrides

| Var        | Default                | Notes                                                            |
| ---------- | ---------------------- | ---------------------------------------------------------------- |
| `TEST_USERNAME` | `testuser`             | Seeded automatically when the server runs with `APP_ENV=test`.   |
| `TEST_PASSWORD` | `irrelevant`           | The test auth service ignores the password for the seeded user. |
| `OUTPUT`   | `./<server-filename>`  | Target path. If it points to an existing directory, the server-supplied filename is appended; otherwise the value is used as the literal output path. |
