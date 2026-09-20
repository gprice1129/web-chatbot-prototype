# API Reference

Base URL: `http://<host>` (default `http://localhost:8080` in test scripts — nginx in
`docker-compose.yml` listens on port 8080 and proxies `/api/` to the app)

All endpoints under `/api/` require a session cookie obtained via the login endpoint.
Requests to resources the authenticated user does not own return **404** to avoid leaking existence.

Validation failures return **400** with `{ "error": "<message>" }`. Most other errors use the
same `{ "error": "..." }` shape.

**Nullable fields.** Any field documented below as `string | null` serializes as
JSON `null` when unset. Earlier builds coerced these to an empty string (`""`) on
the way out, so clients that special-cased `""` to mean "unset" should now test
for `null`. This affects `description` and `instructions` on projects,
`description` on applications, and `original_filename` on files.

---

## Health

### GET `/health`

Liveness probe. Does **not** require authentication and is **not** prefixed with `/api/`.

**Response `200`**

```json
{
  "message": "OK"
}
```

---

## Authentication

### POST `/api/login`

Authenticate and obtain a session cookie.

**Request**

```json
{
  "username": "string",
  "password": "string"
}
```

**Response `200`**

```json
{
  "message": "OK"
}
```

A `Set-Cookie` header sets a signed, `httpOnly`, `sameSite=strict`, `secure`
`session=<token>` cookie.

**Error**

| Status | Description |
|--------|-------------|
| 401 | Username or password is incorrect |
| 429 | Too many login attempts from this IP (see `RATE_LIMIT_LOGIN_*`) |
| 500 | Internal error while authenticating |

**Usage**

Pass the `session` cookie on all subsequent requests via the `Cookie` header:

```
Cookie: session=<token>
```

> **Test environment:** With `APP_ENV=test`, the server seeds a `testuser` account
> and ignores the password value.

---

### POST `/api/logout`

Revoke the current session and clear the `session` cookie.

**Response `200`**

```json
{
  "message": "OK"
}
```

**Error**

| Status | Description |
|--------|-------------|
| 401 | No valid session cookie was presented |
| 500 | Internal error while revoking the session |

---

## Chats

### POST `/api/chats`

Create a new chat.

**Request**

```json
{
  "title": "string"
}
```

**Response `200`**

```json
{
  "id": "string",
  "title": "string"
}
```

---

### GET `/api/chats`

List all chats owned by the authenticated user, newest first.

**Response `200`**

```json
{
  "chats": [
    {
      "id": "string",
      "title": "string",
      "created_at": "string (ISO 8601)",
      "updated_at": "string (ISO 8601)"
    }
  ]
}
```

---

### PATCH `/api/chats/:chat_id`

Update a chat's title.

**Path Parameters**

| Name | Type | Description |
|------|------|-------------|
| `chat_id` | string | The chat's UUID |

**Request**

```json
{
  "title": "string"
}
```

**Response `200`**

```json
{
  "id": "string",
  "title": "string"
}
```

**Error**

| Status | Description |
|--------|-------------|
| 404 | Chat does not exist or is not owned by the authenticated user |

---

### DELETE `/api/chats/:chat_id`

Delete a chat. Cascades in the database to the chat's messages, file-attachment links,
and project membership rows; the chat's uploaded files and any projects themselves are
not deleted.

**Path Parameters**

| Name | Type | Description |
|------|------|-------------|
| `chat_id` | string | The chat's UUID |

**Response `200`**

```json
{
  "message": "OK"
}
```

**Error**

| Status | Description |
|--------|-------------|
| 404 | Chat does not exist or is not owned by the authenticated user |

---

### GET `/api/chats/:chat_id/messages`

List all messages in a chat, ordered by `created_at` ascending.

**Path Parameters**

| Name | Type | Description |
|------|------|-------------|
| `chat_id` | string | The chat's UUID |

**Response `200`**

```json
{
  "messages": [
    {
      "id": "string",
      "chat_id": "string",
      "role": "string",
      "content": "string",
      "metadata": {},
      "file_ids": ["string"],
      "created_at": "string (ISO 8601)"
    }
  ]
}
```

The `file_ids` array contains UUIDs of files attached to a message. Hydrate them
to full metadata via `POST /api/chats/:chat_id/files/info`.

**Error**

| Status | Description |
|--------|-------------|
| 404 | Chat does not exist or is not owned by the authenticated user |

---

## Files

All file endpoints are scoped to a chat. The `chat_id` in the path is validated
by a server-side hook; a chat not owned by the authenticated user returns **404**
before the handler runs.

### POST `/api/chats/:chat_id/files/upload`

Upload a file to a chat.

**Path Parameters**

| Name | Type | Description |
|------|------|-------------|
| `chat_id` | string | The chat's UUID |

**Request**

Content-Type: `multipart/form-data`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | file | Yes | The file to upload. The original filename is preserved and participates in type resolution (see below). |
| *(any other field)* | string | No | Additional string fields are stored as key-value metadata on the file row (e.g. `role=rfa`). |

Supported MIME types: `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
`text/plain`, `text/markdown`. Maximum upload size: 25 MiB (one file per request).

**Media type resolution**

The server does not trust the declared `Content-Type` outright. It resolves the
stored MIME type in three steps, and a file that fails any of them is rejected
with **415**:

1. **Sniff the bytes.** Magic-byte detection settles binary types (PDF, DOCX)
   and always wins over whatever the client declared.
2. **Fall back to the declaration, then the filename.** Text has no magic bytes,
   so when sniffing is inconclusive:
   - a declared `text/plain` or `text/markdown` is accepted as-is;
   - a declaration of `application/octet-stream` or an empty one — i.e. the
     client had nothing useful to say — falls back to the filename extension,
     matching `.txt` → `text/plain` and `.md` / `.markdown` → `text/markdown`
     (case-insensitive, final extension only);
   - any other declared type is taken at its word and rejected if unsupported.
     A `.md` filename does **not** rescue a part declared `text/html`.

   Binary types are never inferred from the extension — naming a file
   `report.pdf` will not get undetectable bytes recorded as a PDF.
3. **Verify text content.** For a resolved text type, the server peeks at the
   first 8000 bytes and confirms they are valid UTF-8 with no NUL byte. Binary
   content declared as text, or text saved in a non-UTF-8 encoding such as
   latin-1, is rejected rather than stored as mojibake.

> **Client note:** browsers and some operating systems send
> `application/octet-stream` for `.md` files when the OS has no registered
> mapping for the extension. Such uploads now succeed on the strength of the
> filename; previously they returned **415**.

**Response `200`**

```json
{
  "id": "string (UUID)",
  "status": "string"
}
```

`status` is `queued` for parsable MIME types (PDF, DOCX, etc.) or `uploaded` for
non-parsable types (e.g. plain text). Parsable files are processed asynchronously
by the parser worker.

The uploaded bytes are persisted through the `file_storage` service (local-disk
backend by default); each `db.files` row records the owning `storage_backend` so
it can be routed back to the service that holds its bytes.

A successful upload also records a `USER` message on the chat whose `content` is
the original filename (or `"Uploaded file"` when the client sent none) and whose
`file_ids` contains the file's ID, so the upload appears in
`GET /api/chats/:chat_id/messages`.

Uploads are deduplicated per user by content checksum: re-uploading identical
bytes returns the existing file's `id` and `status` rather than creating a second
row, and attaches that existing file to the chat named in the path. Dedup keeps
the **first** upload's `original_filename`, so an `id` returned this way may
report a different filename than the one just sent.

**Error**

| Status | Description |
|--------|-------------|
| 400 | No file provided, or upload interrupted |
| 404 | Chat does not exist or is not owned by the authenticated user |
| 413 | File exceeds the 25 MiB limit |
| 415 | Unsupported MIME type, or a text upload whose content is not valid UTF-8 (`{ "error": "File content is not valid UTF-8 text" }`) |

---

### GET `/api/chats/:chat_id/files/status/:file_id`

Check the processing status of an uploaded file.

**Path Parameters**

| Name | Type | Description |
|------|------|-------------|
| `chat_id` | string | The chat's UUID |
| `file_id` | string | The file's UUID |

**Response `200`**

```json
{
  "id": "string",
  "status": "string"
}
```

**Possible `status` values**

| Status | Terminal? | Description |
|--------|-----------|-------------|
| `uploaded` | Yes | File is not parsable; raw bytes are the final artifact |
| `queued` | No | File is waiting to be parsed |
| `parsed` | Yes | File was successfully parsed |
| `parse_failed` | Yes | Parsing failed |

Poll this endpoint until a terminal status is reached before using the file in
downstream operations (e.g. grant review).

**Error**

| Status | Description |
|--------|-------------|
| 404 | Chat, or file within that chat, does not exist or is not owned by the authenticated user |

---

### POST `/api/chats/:chat_id/files/info`

Batch-fetch metadata for one or more files. IDs the caller cannot see (wrong
owner or wrong chat) are silently omitted from the response.

**Path Parameters**

| Name | Type | Description |
|------|------|-------------|
| `chat_id` | string | The chat's UUID |

**Request**

```json
{
  "ids": ["string (UUID)", "..."]
}
```

**Response `200`**

```json
{
  "files": [
    {
      "id": "string",
      "original_filename": "string | null",
      "mime_type": "string",
      "size_bytes": "string",
      "status": "string",
      "metadata": {}
    }
  ]
}
```

> Compare the length of the returned `files` array against the length of the
> requested `ids` to detect partial results.

---

### GET `/api/chats/:chat_id/files/download/:file_id`

Download the original file bytes.

**Path Parameters**

| Name | Type | Description |
|------|------|-------------|
| `chat_id` | string | The chat's UUID |
| `file_id` | string | The file's UUID |

**Response `200`**

Returns the raw binary stream with:

| Header | Value |
|--------|-------|
| `Content-Type` | The file's detected MIME type |
| `Content-Disposition` | `attachment; filename="<name>"; filename*=UTF-8''<percent-encoded-name>` |

**Error**

| Status | Description |
|--------|-------------|
| 404 | Chat, or file within that chat, does not exist or is not owned by the authenticated user |

---

## Projects

A project is a user-owned collection of chats — a way to group related
conversations. Listing is always scoped to the authenticated user. Membership is
many-to-many: a chat may belong to multiple projects, and a project holds many
chats (junction table `project_chats`).

Each project may also carry configuration fields: an optional **description**,
free-form **instructions** prepended to the system prompt of every chat in the
project, and a **memory_enabled** flag (defaults to `false`) that opts in to
cross-chat context within the project.

Deleting a project removes only its membership links; the member chats survive
and simply leave the project. Likewise, deleting a chat drops its links without
touching any project.

Project ownership is validated by a server-side hook (mirroring the chat hook),
so a project not owned by the authenticated user returns **404** before the
handler runs.

### POST `/api/projects`

Create a new project.

**Request**

```json
{
  "name": "string"
}
```

Project names are **not** unique — a user may have two projects with the same name.

**Response `200`**

```json
{
  "id": "string",
  "name": "string"
}
```

---

### GET `/api/projects`

List all projects owned by the authenticated user, newest first.

**Response `200`**

```json
{
  "projects": [
    {
      "id": "string",
      "name": "string",
      "description": "string | null",
      "instructions": "string | null",
      "memory_enabled": "boolean",
      "created_at": "string (ISO 8601)",
      "updated_at": "string (ISO 8601)"
    }
  ]
}
```

`description` and `instructions` are returned in full, so a client can render or
edit a project's configuration without a follow-up request. Both are `null` when
unset.

---

### PATCH `/api/projects/:project_id`

Update a project's configuration. All body fields are optional — send only the
fields you want to change; omitted fields keep their current value.

**Path Parameters**

| Name | Type | Description |
|------|------|-------------|
| `project_id` | string | The project's UUID |

**Request**

```json
{
  "name": "string",
  "description": "string | null",
  "instructions": "string | null",
  "memory_enabled": "boolean"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | New display name (min length 1). Omit to leave unchanged. |
| `description` | string \| null | Human-readable blurb. Omit to leave unchanged; send `null` to clear. |
| `instructions` | string \| null | Text prepended to the system prompt of every chat in the project. Omit to leave unchanged; send `null` to clear. |
| `memory_enabled` | boolean | When `true`, bots may draw on all chats in the project for additional context. Omit to leave unchanged. |

**Response `200`**

```json
{
  "id": "string",
  "name": "string",
  "description": "string | null",
  "instructions": "string | null",
  "memory_enabled": "boolean"
}
```

A cleared `description` or `instructions` comes back as JSON `null`, not `""`.

**Error**

| Status | Description |
|--------|-------------|
| 404 | Project does not exist or is not owned by the authenticated user |

---

### DELETE `/api/projects/:project_id`

Delete a project. Member chats are unlinked but not deleted.

**Path Parameters**

| Name | Type | Description |
|------|------|-------------|
| `project_id` | string | The project's UUID |

**Response `200`**

```json
{
  "message": "string"
}
```

**Error**

| Status | Description |
|--------|-------------|
| 404 | Project does not exist or is not owned by the authenticated user |

---

### GET `/api/projects/:project_id/chats`

List the chats that belong to a project, newest first.

**Path Parameters**

| Name | Type | Description |
|------|------|-------------|
| `project_id` | string | The project's UUID |

**Response `200`**

```json
{
  "chats": [
    {
      "id": "string",
      "title": "string",
      "created_at": "string (ISO 8601)",
      "updated_at": "string (ISO 8601)"
    }
  ]
}
```

**Error**

| Status | Description |
|--------|-------------|
| 404 | Project does not exist or is not owned by the authenticated user |

---

### POST `/api/projects/:project_id/chats`

Add a chat to a project. The link is created only if **both** the project and
the chat are owned by the authenticated user.

**Path Parameters**

| Name | Type | Description |
|------|------|-------------|
| `project_id` | string | The project's UUID |

**Request**

```json
{
  "chat_id": "string"
}
```

**Response `200`**

```json
{
  "message": "string"
}
```

**Error**

| Status | Description |
|--------|-------------|
| 404 | Project (or chat) does not exist or is not owned by the authenticated user |

---

### DELETE `/api/projects/:project_id/chats/:chat_id`

Remove a chat from a project. The chat itself is not deleted.

**Path Parameters**

| Name | Type | Description |
|------|------|-------------|
| `project_id` | string | The project's UUID |
| `chat_id` | string | The chat's UUID |

**Response `200`**

```json
{
  "message": "string"
}
```

**Error**

| Status | Description |
|--------|-------------|
| 404 | Project does not exist, is not owned by the authenticated user, or the chat is not linked to the project |

---

## Applications

### GET `/api/applications`

List available applications.

**Response `200`**

```json
{
  "applications": [
    {
      "id": "string",
      "slug": "string",
      "name": "string",
      "description": "string | null"
    }
  ]
}
```

Seeded applications include `grant-reviewer` and `ally`.

---

### POST `/api/applications/ally`

Send a message to **Ally**, a general-purpose conversational assistant for UAB /
Hugh Kaul Precision Medicine Institute work that also guides users to the site's
other tools.

Unlike the one-shot grant reviewer, Ally is conversational: the handler replays
the chat's prior user/assistant messages from the database into the model's
memory, appends the new message, generates a reply under the Ally persona, and
records **both** the user message and the assistant reply on the chat. Ally takes
no file uploads.

**Request**

```json
{
  "chat_id": "string",
  "message": "string"
}
```

**Response `200`**

```json
{
  "message": ["string", "..."],
  "steps": [
    {
      "text": "string",
      "calls": [{ "name": "string", "input": {}, "ok": true }]
    }
  ]
}
```

The `message` array contains the reply's text blocks (joined with blank lines
when persisted). `steps` lists each tool round behind the reply: the model's
preface (the text it wrote before asking for tools) and the calls it made,
without tool result bodies. It is an empty array when the model answered
without tools.

Conversational memory is rebuilt from the chat's stored messages on each call,
so subsequent turns see earlier ones even across separate requests. Tool-round
`steps` are also stored on the assistant message's `metadata` when non-empty.

When `APP_DEBUG` (or the server's debug mode) is on, the JSON body also includes
`debug` with the full model trace (`rounds`, `tool_calls` with result previews,
and `usage`).

**Streaming (`Accept: text/event-stream`)**

Clients that send `Accept: text/event-stream` receive Server-Sent Events instead
of a single JSON body. Each event is one `data:` line of JSON:

| Event | Shape | When |
|-------|--------|------|
| `text` | `{ "type": "text", "text": "..." }` | Reply text as the model writes it (including tool-round prefaces) |
| `tool` | `{ "type": "tool", "calls": [{ "name", "input" }] }` | A round stopped to call tools; text since the last event was its preface, not the answer |
| `done` | `{ "type": "done", "message": [...], "steps": [...], "debug"? }` | Same payload a JSON client would get on success |
| `error` | `{ "type": "error", "status": 502, "error": "..." }` | Same status/message a JSON client would get on failure |

Comment lines (`: ping`) may appear as heartbeats while the model thinks or
tools run. Validation failures (missing chat, bad body) still return plain JSON
before the stream starts. If the client disconnects while the reply is being
generated, generation is aborted and the exchange is not persisted. A
disconnect after generation has finished still persists the exchange; only the
`done` event is lost.

**Error**

| Status | Description |
|--------|-------------|
| 404 | Chat does not exist or is not owned by the authenticated user |
| 429 | Too many requests from this user (see `RATE_LIMIT_ALLY_*`) |
| 499 | Client disconnected before the reply finished (streaming) |
| 502 | Model returned an incomplete response, or exceeded its tool round limit |
| 503 | Model provider temporarily unavailable (`Retry-After: 30`) |
| 500 | Failed to record the assistant reply |

---

### POST `/api/applications/grant_review`

Run a grant review on a chat's uploaded documents. The handler resolves the
required files from the chat by their `metadata.role` values, reads their text
content, generates the review, and records the result as an `ASSISTANT` message
on the chat.

**Query Parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `mode` | string | Yes | Review mode. One of: `standard`, `summary`, `technical`, `scored`, `aims` |

**Request**

```json
{
  "chat_id": "string"
}
```

**Required uploaded files (by `metadata.role`)**

| Mode | Required roles |
|------|----------------|
| `standard`, `summary`, `technical`, `scored` | `rfa` + `proposal` |
| `aims` | `rfa` + `aims` |

Files must have reached a terminal parse status before calling this endpoint.

**Response `200`**

```json
{
  "message": ["string", "..."]
}
```

The `message` array contains the review's text blocks (joined with blank lines
when persisted).

**Streaming (`Accept: text/event-stream`)**

Same SSE protocol as Ally (`text` / `tool` / `done` / `error`), except a
successful `done` event carries `{ "type": "done", "message": [...] }` (no
`steps`). Grant review does not currently expose tools, so `tool` events are
not expected in practice.

**Error**

| Status | Description |
|--------|-------------|
| 400 | Missing or unsupported `mode`, missing required files (`rfa` / `proposal` or `rfa` / `aims`), file not ready, or invalid document content |
| 404 | Chat does not exist or is not owned by the authenticated user |
| 429 | Too many requests from this user (see `RATE_LIMIT_GRANT_REVIEW_*`) |
| 499 | Client disconnected before the reply finished (streaming) |
| 502 | Model returned an incomplete response |
| 503 | Model provider temporarily unavailable (`Retry-After: 30`) |
| 500 | Failed to read a file or record the review message |

---

## Common Flows

### Full Grant Review (end-to-end)

1. **Login** -- `POST /api/login`
2. **Create a chat** -- `POST /api/chats` with `{ title }`
3. **Upload the RFA** -- `POST /api/chats/:chat_id/files/upload` with `metadata.role = "rfa"`
4. **Upload the companion doc** -- `POST /api/chats/:chat_id/files/upload` with `metadata.role = "proposal"` (or `"aims"` for aims mode)
5. **Poll file status** -- `GET /api/chats/:chat_id/files/status/:file_id` until both files reach a terminal status
6. **Run the review** -- `POST /api/applications/grant_review?mode=standard` with `{ chat_id }`

### Ally Conversation

1. **Login** -- `POST /api/login`
2. **Create a chat** -- `POST /api/chats` with `{ title }`
3. **Send a message** -- `POST /api/applications/ally` with `{ chat_id, message }`; repeat for multi-turn conversation
4. **Inspect the transcript** -- `GET /api/chats/:chat_id/messages`

### Project Round Trip (create, populate, inspect, clean up)

1. **Login** -- `POST /api/login`
2. **Create a project** -- `POST /api/projects` with `{ name }`
3. **Create / pick a chat** -- `POST /api/chats`
4. **Add the chat** -- `POST /api/projects/:project_id/chats` with `{ chat_id }`
5. **List project chats** -- `GET /api/projects/:project_id/chats`
6. **Remove the chat** -- `DELETE /api/projects/:project_id/chats/:chat_id`
7. **Delete the project** -- `DELETE /api/projects/:project_id`

### File Round Trip (upload, parse, download)

1. **Login** -- `POST /api/login`
2. **Upload** -- `POST /api/chats/:chat_id/files/upload`
3. **Poll status** -- `GET /api/chats/:chat_id/files/status/:file_id` until terminal
4. **Download** -- `GET /api/chats/:chat_id/files/download/:file_id`

---

## TypeScript Client Examples

Standalone test scripts are available under `packages/test/src/`. Each script
exports a reusable async function and includes a CLI driver.

| Script | Endpoint | Run command |
|--------|----------|-------------|
| `chat-create` | `POST /api/chats` | `npm run chat-create -- <title> [base-url]` |
| `chat-get` | `GET /api/chats` | `npm run chat-get -- [base-url]` |
| `chat-update` | `PATCH /api/chats/:chat_id` | `npm run chat-update -- <chat-id> <title> [base-url]` |
| `chat-delete` | `DELETE /api/chats/:chat_id` | `npm run chat-delete -- <chat-id> [base-url]` |
| `chat-messages-get` | `GET /api/chats/:chat_id/messages` | `npm run chat-messages-get -- <chat-id> [base-url]` |
| `application-get` | `GET /api/applications` | `npm run application-get -- [base-url]` |
| `file-upload` | `POST /api/chats/:chat_id/files/upload` | `npm run file-upload -- <chat-id> <path> [base-url]` |
| `file-upload --cases` | Media-type gate matrix (no file on disk needed) | `npm run file-upload -- --cases <chat-id> [base-url]` |
| `file-status` | `GET /api/chats/:chat_id/files/status/:file_id` | `npm run file-status -- <chat-id> <file-id> [base-url]` |
| `file-download` | `GET /api/chats/:chat_id/files/download/:file_id` | `npm run file-download -- <chat-id> <file-id> [base-url]` |
| `files-info` | `POST /api/chats/:chat_id/files/info` | `npm run files-info -- <chat-id> <file-id> [...] [-- <base-url>]` |
| `grant-review` | `POST /api/applications/grant_review` | `npm run grant-review -- <chat-id> [mode] [base-url]` |
| `ally` | `POST /api/applications/ally` | `npm run ally -- <chat-id> [message] [base-url]` |
| `project-create` | `POST /api/projects` | `npm run project-create -- <name> [base-url]` |
| `project-get` | `GET /api/projects` | `npm run project-get -- [base-url]` |
| `project-update` | `PATCH /api/projects/:project_id` | `npm run project-update -- <project-id> <name> [base-url]` |
| `project-delete` | `DELETE /api/projects/:project_id` | `npm run project-delete -- <project-id> [base-url]` |
| `project-chats-get` | `GET /api/projects/:project_id/chats` | `npm run project-chats-get -- <project-id> [base-url]` |
| `project-chat-add` | `POST /api/projects/:project_id/chats` | `npm run project-chat-add -- <project-id> <chat-id> [base-url]` |
| `project-chat-remove` | `DELETE /api/projects/:project_id/chats/:chat_id` | `npm run project-chat-remove -- <project-id> <chat-id> [base-url]` |
| `file-round-trip` | Upload + poll + download | `npm run file-round-trip -- <chat-id> <path> [base-url]` |
| `project-round-trip` | Project create + populate + inspect + clean up | `npm run project-round-trip -- [base-url]` |
| `grant-review-full` | Full grant review flow | `npm run grant-review-full -- <rfa-path> <companion-path> [mode] [base-url]` |
| `login-rate-limit` | Login rate-limit behavior | `npm run login-rate-limit -- [base-url] [--check-reset]` |
| `login-limits` | Login input/body limits | `npm run login-limits -- [base-url]` |

All test scripts default to `http://localhost:8080` and expect `APP_ENV=test` on the
server. Override credentials with the `TEST_USERNAME` and `TEST_PASSWORD`
environment variables (defaults: `testuser` / `irrelevant`).

The `--cases` mode of `file-upload` posts a fixed matrix of synthetic uploads and
asserts each one gets the status the media-type gate owes it — covering the
octet-stream filename fallback, unusable extensions, unsupported declared types,
and the UTF-8 content check. It is re-runnable: the accepted case dedups by
checksum on a second run and still answers `200`.

---

## Environment Variables (Server)

| Variable | Description |
|----------|-------------|
| `APP_ENV` | Set to `test` to seed test data and enable the test auth service |
| `COOKIE_KEY` / `COOKIE_KEY_FILE` | Secret for signing session cookies |
| `FILES_BASE_PATH` | Local-disk path used by the file storage backend |
| `ANTHROPIC_BASE_URL` | Base URL the chatbot targets for LLM calls |
| `ANTHROPIC_BASE_URL_API_KEY` / `ANTHROPIC_BASE_URL_API_KEY_FILE` | Credential for `ANTHROPIC_BASE_URL` |
| `APP_DB_USER` / `APP_DB_PASSWORD` / `APP_DB_NAME` | Application Postgres connection settings |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` | Postgres superuser, used only during initial DB setup |
| `SERVER_NAME` | Nginx `server_name` |
| `RATE_LIMIT_LOGIN_MAX` / `RATE_LIMIT_LOGIN_WINDOW` | Per-IP login rate limit (default `5` / `1 minute`) |
| `RATE_LIMIT_ALLY_MAX` / `RATE_LIMIT_ALLY_WINDOW` | Per-user Ally rate limit (default `30` / `1 minute`) |
| `RATE_LIMIT_GRANT_REVIEW_MAX` / `RATE_LIMIT_GRANT_REVIEW_WINDOW` | Per-user grant-review rate limit (default `10` / `1 hour`) |
| `LOGIN_USERNAME_MAX_LENGTH` / `LOGIN_PASSWORD_MAX_LENGTH` / `LOGIN_BODY_LIMIT` | Login input and body-size limits |
| `TRUST_PROXY` | When set (`true`, `false`, or hop count), controls Fastify `trustProxy` for client IP behind nginx |
| `SSE_HEARTBEAT` | Interval between keep-alive comments on a streamed bot reply, as a duration like the rate-limit windows (default `15 seconds`) |

### Model Generation Parameters

Each model the server builds reads an optional set of generation parameters from
the environment. The prefixes are `MODEL_ALLY` (Ally), `MODEL_GRANT_REVIEW`
(grant reviewer), and `MODEL_SUMMARY` (chat summarization for project memory).

| Variable | Accepted values |
|----------|-----------------|
| `${prefix}_EFFORT` | `none`, `low`, `medium`, `high`, `max` |
| `${prefix}_THINKING` | `none`, `adaptive`, `disabled`, or a positive integer thinking-token budget |
| `${prefix}_CACHING` | `none`, `5m`, `1h` (prompt-cache TTL) |
| `${prefix}_MAX_TOKENS` | Positive integer (output token cap per response) |

An unset or blank variable keeps the model profile's default; `none` explicitly
unsets the parameter so it is omitted from API requests. Invalid values — and
combinations the model rejects — fail startup with a descriptive error. These
variables are ignored when `APP_ENV=test`, which substitutes a mock model.
