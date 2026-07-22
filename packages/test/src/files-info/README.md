# files-info

End-to-end exercise of `POST /api/chats/:chat_id/files/info`. Logs in as `testuser` and POSTs a list of file ids, printing the `{ files: [...] }` response. Pair with `chat-messages-get`: that endpoint returns `file_ids` per message, and this one hydrates them to full metadata.

## Prerequisites

- Webserver running and reachable (default `http://localhost:8080`).
- Server started with `APP_ENV=test`, which seeds `testuser` and configures the testing auth service to ignore the password.
- A chat id owned by `testuser` and one or more file ids attached to that chat — typically obtained from a prior `npm run chat-create` and `npm run file-upload`.
- Self-signed cert is fine — the script sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Run

From `packages/test/`:

```sh
npm run build
npm run files-info -- <chat-id> <file-id> [<file-id> ...] [-- <base-url>]
```

`base-url` defaults to `http://localhost:8080`. Pass a full URL (e.g. `https://localhost`) to target a TLS frontend. The `--` before `<base-url>` separates it from the file id list so multiple ids can be passed positionally.

File ids the caller cannot see (wrong owner or not attached to this chat) are silently omitted from the response; compare lengths to detect partial hits.

## Env overrides

| Var        | Default      | Notes                                                            |
| ---------- | ------------ | ---------------------------------------------------------------- |
| `TEST_USERNAME` | `testuser`   | Seeded automatically when the server runs with `APP_ENV=test`.   |
| `TEST_PASSWORD` | `irrelevant` | The test auth service ignores the password for the seeded user. |
