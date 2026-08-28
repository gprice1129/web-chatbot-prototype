# project-update

End-to-end exercise of `PATCH /api/projects/:project_id`. Logs in as `testuser`, renames the given project, and prints the `{ id, name }` response.

## Prerequisites

- Webserver running and reachable (default `http://localhost:8080`).
- Server started with `AUTH_MODE=mock`, which seeds `testuser` and configures the mock auth service to ignore the password.
- `<project-id>` must be a project owned by `testuser` — typically obtained from `npm run project-create`.
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run project-update -- <project-id> <name> [base-url]
```

`base-url` defaults to `http://localhost:8080`. Pass a full URL (e.g. `https://localhost`) to target a TLS frontend.

## Env overrides

| Var        | Default      | Notes                                                            |
| ---------- | ------------ | ---------------------------------------------------------------- |
| `TEST_USERNAME` | `testuser`   | Seeded automatically when the server runs with `AUTH_MODE=mock`.   |
| `TEST_PASSWORD` | `irrelevant` | The test auth service ignores the password for the seeded user. |
