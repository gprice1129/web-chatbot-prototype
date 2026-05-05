# test

Manual test scripts that exercise the webserver's HTTP API. Each script logs in, runs one request, and prints the status + response body.

## Prerequisites

- The webserver is running and reachable (default: `https://localhost`).
- The server is started with `APP_ENV=test`, which auto-seeds the `testuser` account used by the scripts.
- A self-signed cert is fine — the client sets `NODE_TLS_REJECT_UNAUTHORIZED=0`.

## Build

From the repo root or this package:

```sh
npm run build
```

## Scripts

Run from `packages/test/`. Use `--` so npm forwards positional args to the script.

| Command                                      | Description                                  |
| -------------------------------------------- | -------------------------------------------- |
| `npm run upload-file -- <path> [base-url]`   | `POST /api/files/upload` with the given file |
| `npm run file-status -- <file-id> [base-url]` | `GET /api/files/status/:file_id`             |

`base-url` is optional and defaults to `https://localhost`.

### Examples

```sh
# Upload a sample doc
npm run upload-file -- data/pdf_test.pdf

# Check parse status for the returned file id
npm run file-status -- 01HXYZ...

# Point at a non-default server
npm run upload-file -- data/docx_test.docx https://staging.example.com
```

## Env overrides

| Var        | Default       | Notes                                                          |
| ---------- | ------------- | -------------------------------------------------------------- |
| `USERNAME` | `testuser`    | Seeded automatically when the server runs with `APP_ENV=test`. |
| `PASSWORD` | `irrelevant`  | The test auth service ignores the password for the seeded user. |

## Sample data

`data/` contains small fixture files (`pdf_test.pdf`, `docx_test.docx`) suitable for upload smoke tests.
