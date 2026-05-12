# grant-review-full

End-to-end exercise of the full grant review flow: creates a chat, uploads the rfa and companion documents with the right `metadata.role`, waits for parsing to finish, then runs `POST /api/applications/grant_review`. Prints `{ chat_id, rfa, companion, review }`.

## Prerequisites

- Webserver running and reachable (default `https://localhost`).
- Server started with `APP_ENV=test`, which seeds `testuser` and configures the testing auth service to ignore the password.
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- The parser worker is running so parsable mimes (pdf, docx, …) transition from `queued` to `parsed`. Plain-text uploads skip parsing.

## Run

From `packages/test/`:

```sh
npm run build
npm run grant-review-full -- <rfa-path> <companion-path> [mode] [base-url]
```

`companion-path` is the proposal document for the default modes, or the specific-aims document when `mode=aims`. `mode` defaults to `standard`. Valid modes: `standard`, `summary`, `technical`, `scored`, `aims`. `base-url` defaults to `https://localhost`.

Examples:

```sh
npm run grant-review-full -- ./data/rfa.pdf ./data/proposal.pdf
npm run grant-review-full -- ./data/rfa.pdf ./data/specific-aims.pdf aims
```

## Env overrides

| Var                | Default                   | Notes                                                            |
| ------------------ | ------------------------- | ---------------------------------------------------------------- |
| `USERNAME`         | `testuser`                | Seeded automatically when the server runs with `APP_ENV=test`.   |
| `PASSWORD`         | `irrelevant`              | The test auth service ignores the password for the seeded user. |
| `TITLE`            | `Grant review full test`  | Title for the chat created by step 1.                            |
| `POLL_INTERVAL_MS` | `1000`                    | Delay between file-status polls during parse wait.               |
| `POLL_TIMEOUT_MS`  | `60000`                   | Hard cap on total wait time per file.                            |
