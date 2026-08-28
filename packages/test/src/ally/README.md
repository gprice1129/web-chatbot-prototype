# ally

End-to-end exercise of `POST /api/applications/ally` — the general-purpose, conversational Ally chatbot. Logs in as `testuser`, sends the chat id with a free-text `message`, and prints the `{ message: [...] }` reply. The handler also records the user message and the assistant reply on the chat — verify with `npm run chat-messages-get`.

Unlike the grant reviewer, Ally is **conversational**: it replays the chat's prior user/assistant messages into the model's memory before answering, so later turns see earlier ones. It takes **no files**.

## Prerequisites

- Webserver running and reachable (default `http://localhost:8080`).
- Server started with `AUTH_MODE=mock`, which seeds `testuser` and configures the mock auth service to ignore the password.
- A chat id owned by `testuser` — typically from a prior `npm run chat-create` run.
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run ally -- <chat-id> [message] [base-url]
```

With no `[message]`, the driver runs a short scripted conversation that exercises domain knowledge (UAB / Hugh Kaul), the grant-reviewer hand-off link (`/apps/grant-reviewer`), and multi-turn memory (the final turn asks Ally to recall the earlier request). Pass an explicit `[message]` to send a single turn instead. `base-url` defaults to `http://localhost:8080`. Pass a full URL (e.g. `https://localhost`) to target a TLS frontend.

## Env overrides

| Var        | Default      | Notes                                                            |
| ---------- | ------------ | ---------------------------------------------------------------- |
| `TEST_USERNAME` | `testuser`   | Seeded automatically when the server runs with `AUTH_MODE=mock`.   |
| `TEST_PASSWORD` | `irrelevant` | The test auth service ignores the password for the seeded user. |
