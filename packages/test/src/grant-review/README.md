# grant-review

End-to-end exercise of `POST /api/applications/grant_review`. Logs in as `testuser`, sends the chat id with a mode query param, and prints the `{ message: [...] }` response. The handler also records the review as an `ASSISTANT` message on the chat — verify with `npm run chat-messages-get`.

## Prerequisites

- Webserver running and reachable (default `http://localhost:8080`).
- Server started with `APP_ENV=test`, which seeds `testuser` and configures the testing auth service to ignore the password.
- A chat id owned by `testuser` — typically from a prior `npm run chat-create` run.
- The chat already has the required files uploaded (via `npm run file-upload`) with the right metadata:
  - rfa file: `metadata.role = "rfa"`
  - companion file: `metadata.role = "proposal"` for the default modes, or `metadata.role = "aims"` when `mode=aims`.
- For parsable mime types (pdf/docx/…), the files must have reached `parsed` status. Plain text uploads are read directly.
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run grant-review -- <chat-id> [mode] [base-url]
```

`mode` defaults to `standard`. Valid modes: `standard`, `summary`, `technical`, `scored`, `aims`. `base-url` defaults to `http://localhost:8080`. Pass a full URL (e.g. `https://localhost`) to target a TLS frontend.

## Env overrides

| Var        | Default      | Notes                                                            |
| ---------- | ------------ | ---------------------------------------------------------------- |
| `TEST_USERNAME` | `testuser`   | Seeded automatically when the server runs with `APP_ENV=test`.   |
| `TEST_PASSWORD` | `irrelevant` | The test auth service ignores the password for the seeded user. |
