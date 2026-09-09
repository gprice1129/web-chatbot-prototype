# file-round-trip

End-to-end exercise of the full file lifecycle: upload → poll status until parsed → download.

The script logs in once, posts a multipart `file` part to `POST /api/chats/:chat_id/files/upload`, polls `GET /api/chats/:chat_id/files/status/:file_id` until the status reaches a terminal state (`parsed`, `parse_failed`, or `uploaded`), and then streams the bytes back from `GET /api/chats/:chat_id/files/download/:file_id`. Prints `{ id, status, download: { output_path, bytes, mime_type } }`.

A `parse_failed` terminal status throws (no point downloading a failed parse). A `parsed` or `uploaded` status proceeds to the download step. `uploaded` is reported when the file's MIME type is not parsable — its bytes are the final artifact and no parse step runs.

## Prerequisites

- Webserver running and reachable (default `http://localhost:8080`).
- Server started with `AUTH_MODE=mock`, which seeds `testuser` and configures the mock auth service to ignore the password.
- A chat id owned by `testuser` — typically obtained from a prior `npm run chat-create` run.
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run file-round-trip -- <chat-id> <path-to-file> [base-url]
```

`base-url` defaults to `http://localhost:8080`. Pass a full URL (e.g. `https://localhost`) to target a TLS frontend.

## Env overrides

| Var                 | Default                | Notes                                                            |
| ------------------- | ---------------------- | ---------------------------------------------------------------- |
| `TEST_USERNAME`          | `testuser`             | Seeded automatically when the server runs with `AUTH_MODE=mock`.   |
| `TEST_PASSWORD`          | `irrelevant`           | The test auth service ignores the password for the seeded user. |
| `OUTPUT`            | `./<server-filename>`  | Target path. If it points to an existing directory, the server-supplied filename is appended; otherwise the value is used as the literal output path. |
| `POLL_INTERVAL_MS`  | `1000`                 | Delay between status polls. |
| `POLL_TIMEOUT_MS`   | `60000`                | Hard cap on total time spent polling. Exceeding it raises a timeout error with the last observed status. |
