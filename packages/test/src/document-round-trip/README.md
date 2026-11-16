# document-round-trip

End-to-end check of **a chat's document**: opened through an application, then read and written by its id. Logs in once as `testuser` and runs:

1. **Open.** Create a chat → `PUT /api/applications/irb-protocol/chats/:chat_id/document` → assert 200, an empty document following `irb-protocol` that the user and the assistant may write, and `GET /api/chats` reports `irb-protocol` → repeat the `PUT` → assert the same document id.
2. **Template.** `GET /api/templates/irb-protocol` → assert 200 and that each section carries only `id`, `title` and `required` → an unknown template id → assert **404**.
3. **Write.** `PUT /api/documents/:document_id/sections/:section_id` for the template's first section → assert 200 and revision 1 → `GET /api/documents/:document_id` and a repeated open both answer the document as written.
4. **Refused writes.** A stale revision → **409**. An unknown section or an unknown document → **404**. An unknown status or a malformed document id → **400**. The document is unchanged afterwards.
5. **Refused reads.** An unknown document → **404**. A malformed document id → **400**.
6. **Refused opens.** A chat registered to `ally` → **409**. An unknown chat → **404**.

Every chat the run creates is deleted at the end. The document it wrote is not: there is no route that deletes a document, so one document and one small version file are left with `testuser` per run. Prints `document round trip: OK` on success; any failed assertion or request exits non-zero.

No check makes a model call.

## Prerequisites

- Webserver running and reachable (default `http://localhost:8080`), **with migration `013` and the `irb-protocol` application seed applied**, and `irb-protocol.json` in its templates directory.
- Server started with `AUTH_MODE=mock`, which seeds `testuser` and configures the mock auth service to ignore the password.
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run document-round-trip -- [base-url]
```

`base-url` defaults to `http://localhost:8080`. Pass a full URL (e.g. `https://localhost`) to target a TLS frontend.

## Env overrides

| Var        | Default      | Notes                                                            |
| ---------- | ------------ | ---------------------------------------------------------------- |
| `TEST_USERNAME` | `testuser`   | Seeded automatically when the server runs with `AUTH_MODE=mock`.   |
| `TEST_PASSWORD` | `irrelevant` | The test auth service ignores the password for the seeded user. |
