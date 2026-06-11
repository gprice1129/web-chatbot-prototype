# project-round-trip

End-to-end round trip for the whole projects API. Logs in as `testuser` and runs the full lifecycle with assertions:

create project → create chat → add chat → list membership → (idempotent re-add) → remove chat → rename project → re-add chat → delete project → confirm the member chat survived.

This is the most complete check of the projects feature — it exercises every route and verifies the junction behaviour (deleting a project leaves its member chats intact). Prints `project round trip: OK` on success; any failed assertion or request exits non-zero.

## Prerequisites

- Webserver running and reachable (default `http://localhost:8080`).
- Server started with `APP_ENV=test`, which seeds `testuser` and configures the testing auth service to ignore the password.
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run project-round-trip -- [base-url]
```

`base-url` defaults to `http://localhost:8080`. Pass a full URL (e.g. `https://localhost`) to target a TLS frontend.

## Env overrides

| Var        | Default      | Notes                                                            |
| ---------- | ------------ | ---------------------------------------------------------------- |
| `USERNAME` | `testuser`   | Seeded automatically when the server runs with `APP_ENV=test`.   |
| `PASSWORD` | `irrelevant` | The test auth service ignores the password for the seeded user. |
