# application-registration

End-to-end check of **chat registration with applications** (migration `012`). Logs in once as `testuser` and runs:

1. **Register route.** Create a chat → `PUT /api/applications/budget-justification/chats/:chat_id` → assert 200 and `GET /api/chats` reports `budget-justification` → repeat the `PUT` → assert 200.
2. **Conflicts.** Create a chat → register it to `ally` → `POST /api/applications/budget-justification` and `PUT /api/applications/budget-justification/chats/:chat_id` → assert **409** for both → the chat is still `ally`.
3. **Unknown chat.** `POST /api/applications/ally` and `PUT /api/applications/ally/chats/:chat_id` with a random chat id → assert **404** for both.
4. **Grant review.** Run the [grant-review-full](../grant-review-full/README.md) flow in `summary` mode on two small generated text files → the chat is registered to `grant-reviewer`.

Every chat the run creates is deleted at the end. Prints `application registration: OK` on success; any failed assertion or request exits non-zero.

Checks 1–3 are answered by the chat-register hook before any handler runs, so they make no model calls. Check 4 runs one real grant review when the server has `MODEL_MODE=real`.

## Prerequisites

- Webserver running and reachable (default `http://localhost:8080`), **with migration `012` and the application seeds applied**.
- Server started with `AUTH_MODE=mock`, which seeds `testuser` and configures the mock auth service to ignore the password.
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run application-registration -- [base-url]
```

`base-url` defaults to `http://localhost:8080`. Pass a full URL (e.g. `https://localhost`) to target a TLS frontend.

## Env overrides

| Var        | Default      | Notes                                                            |
| ---------- | ------------ | ---------------------------------------------------------------- |
| `TEST_USERNAME` | `testuser`   | Seeded automatically when the server runs with `AUTH_MODE=mock`.   |
| `TEST_PASSWORD` | `irrelevant` | The test auth service ignores the password for the seeded user. |
