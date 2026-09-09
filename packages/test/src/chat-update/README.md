# chat-update

End-to-end exercise of `PATCH /api/chats/:chat_id`. Logs in as `testuser`, updates the chat's title, and prints the `{ id, title }` response.

## Prerequisites

- Webserver running and reachable (default `http://localhost:8080`).
- Server started with `AUTH_MODE=mock`, which seeds `testuser` and configures the mock auth service to ignore the password.
- A chat id owned by `testuser` — typically obtained from a prior `npm run chat-create` run.
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run chat-update -- <chat-id> <title> [base-url]
```

`base-url` defaults to `http://localhost:8080`. Pass a full URL (e.g. `https://localhost`) to target a TLS frontend.

## Env overrides

| Var        | Default      | Notes                                                            |
| ---------- | ------------ | ---------------------------------------------------------------- |
| `TEST_USERNAME` | `testuser`   | Seeded automatically when the server runs with `AUTH_MODE=mock`.   |
| `TEST_PASSWORD` | `irrelevant` | The test auth service ignores the password for the seeded user. |
