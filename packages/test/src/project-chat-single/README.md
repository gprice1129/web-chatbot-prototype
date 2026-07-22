# project-chat-single

End-to-end check of the **single-project-per-chat** invariant added in migration `009` (`UNIQUE (chat_id)` on `project_chats`). Logs in as `testuser` and runs:

create project A → create project B → create chat → add chat to A (success) → add **same** chat to B → assert **409 Conflict** → confirm the chat is still in A only, never B → confirm re-adding to A stays idempotent (200) → delete both projects.

This is the non-LLM API surface for [Phase B](../../../../plan/phase-b-db-invariant.md): the DB constraint, surfaced by the route as a `409` (the route maps the `project_chats_unique_chat` unique violation; all other failures still 500). Prints `project chat single: OK` on success; any failed assertion or request exits non-zero.

## Prerequisites

- Webserver running and reachable (default `http://localhost:8080`), **with migration `009` applied**.
- Server started with `APP_ENV=test`, which seeds `testuser` and configures the testing auth service to ignore the password.
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run project-chat-single -- [base-url]
```

`base-url` defaults to `http://localhost:8080`. Pass a full URL (e.g. `https://localhost`) to target a TLS frontend.

## Env overrides

| Var        | Default      | Notes                                                            |
| ---------- | ------------ | ---------------------------------------------------------------- |
| `TEST_USERNAME` | `testuser`   | Seeded automatically when the server runs with `APP_ENV=test`.   |
| `TEST_PASSWORD` | `irrelevant` | The test auth service ignores the password for the seeded user. |
