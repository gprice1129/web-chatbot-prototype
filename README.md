## Prerequisites

- [Node.js](https://nodejs.org/) v22+
- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/)

## Project Structure

```
packages/
  aim_hi_chatbot/    # Chatbot library (Anthropic SDK)
  aim_hi_webserver/  # Fastify web server
config/
  db/                # Database bootstrap script and migrations
  nginx/             # Nginx config and SSL certificates
```

## Setup

### 1. Install dependencies

```sh
npm install
```

### 2. Configure environment and secrets

Non-secret configuration is supplied via an env file read by Docker Compose.
Secret values are **not** kept here — they are mounted into the containers as
files via Docker Compose `secrets:` (see below), which keeps them out of
`docker inspect`, `/proc/<pid>/environ`, child-process env, and crash logs.

Create a `.env` file in the project root:

```env
# Anthropic (the endpoint the chatbot targets; its credential is a secret)
ANTHROPIC_BASE_URL=https://api.anthropic.com

# Postgres / application database (names and roles only; passwords are secrets)
POSTGRES_USER=postgres
APP_DB_USER=app
APP_DB_NAME=chatbot

# Storage, runtime, nginx
FILES_BASE_PATH=/var/lib/aim_hi/uploads
APP_ENV=production
SERVER_NAME=your.domain.com

# Embeddings (self-hosted; see "Semantic search" below). This is the embedding
# server's own --model-id. Leave it blank or omit it to take the
# docker-compose.yml default. Raise EMBEDDER_MAX_BATCH_TOKENS alongside it if
you pick a longer-context model.
EMBEDDER_MODEL=BAAI/bge-large-en-v1.5
```

#### Secrets

The compose stack reads four secrets from files (mounted at
`/run/secrets/<name>`):

| secret file         | used by            |
| ------------------- | ------------------ |
| `postgres_password` | postgres superuser |
| `app_db_password`   | app, parser, db    |
| `cookie_key`        | session signing    |
| `anthropic_api_key` | chatbot credential |

Generate them (random values for the DB/cookie secrets; you paste the API key):

```sh
scripts/gen_secrets.sh                          # writes ./secrets/*
# or point at a location outside the repo on the server:
SECRETS_DIR=/etc/aim-hi/secrets scripts/gen_secrets.sh
```

Compose looks for `./secrets/` by default; override with the `SECRETS_DIR`
variable in your env file. The files are `chmod 600` and the `secrets/`
directory is gitignored. The app also accepts any of these as a plain
`*_FILE` env var (e.g. `COOKIE_KEY_FILE`, `PGPASSWORD_FILE`) if you wire
secrets in some other way.

### 3. TLS

TLS is terminated by the host's nginx, which proxies to the gateway
container on `127.0.0.1:8080` (plain HTTP). Configure certificates and the
HTTP→HTTPS redirect in the host nginx, and make sure it sets
`client_max_body_size 25m` and a `proxy_read_timeout` of at least 300s so
large uploads and long-running API requests are not cut off at the edge.

### 4. Rate limiting

`/login` and the LLM endpoints are rate limited. Login is keyed by client IP;
the LLM endpoints are keyed per authenticated user.

The limits are configurable via env vars, with the default values set in
`docker-compose.yml`. Each endpoint has a `MAX` (request count) and `WINDOW`
(duration); omit either from your `.env` to keep the compose default:

| env var | default | meaning |
| ------- | ------- | ------- |
| `RATE_LIMIT_LOGIN_MAX` / `RATE_LIMIT_LOGIN_WINDOW`               | 5 / 1 minute  | login attempts per IP |
| `RATE_LIMIT_ALLY_MAX` / `RATE_LIMIT_ALLY_WINDOW`                 | 30 / 1 minute | Ally calls per user |
| `RATE_LIMIT_GRANT_REVIEW_MAX` / `RATE_LIMIT_GRANT_REVIEW_WINDOW` | 10 / 1 hour   | grant reviews per user |

`MAX` is a positive integer. `WINDOW` accepts a duration string (`30s`,
`1 minute`, `2h`, `1 day`) or a number of milliseconds. An invalid or missing
value fails fast at startup rather than silently disabling the limit — these are
always set under compose, so set them yourself only if you run the server
outside compose (e.g. local `npm run dev`).

Because the app sits behind nginx, `req.ip` is the proxy's address unless
`TRUST_PROXY` is set — with it unset the login limit is a single shared bucket
(coarse but effective and not spoofable). For the host-nginx → gateway-nginx →
app topology above, set `TRUST_PROXY=2` so the login limit keys on the real
client IP. Add another hop (e.g. `3`) for each additional trusted proxy/CDN in
front. Only enable this when the edge proxies are trusted, since it makes the
app honor the `X-Forwarded-For` header.

### 5. Login input limits

The `/login` request is bounded so oversized input never reaches the password
hash. The field caps reject over-length values with a `400`; the body limit
rejects an oversized request body with a `413` during parsing. All three are
configurable via env vars whose defaults live in `docker-compose.yml`; like the
rate limits, a missing or invalid value fails fast at startup, so set them
yourself only if you run the server outside compose.

| env var | default | meaning |
| ------- | ------- | ------- |
| `LOGIN_USERNAME_MAX_LENGTH` | 64   | max username length, in characters |
| `LOGIN_PASSWORD_MAX_LENGTH` | 256  | max password length, in characters |
| `LOGIN_BODY_LIMIT`          | 4096 | max `/login` request body, in bytes |

### 6. Semantic search (pgvector + embeddings)

Semantic lookup needs two things beyond the base stack: the `vector` extension
in Postgres, and an embedding server.

**Postgres image.** The `postgres` service runs `pgvector/pgvector:pg17`.
`CREATE EXTENSION` requires superuser, so the extension is not applied as a
migration: `config/db/bootstrap.sh` handles a fresh volume, and a superuser
pre-step in `config/db/migrate.sh` handles a database that already exists.
The latter needs `POSTGRES_SUPERUSER` and the `postgres_password` secret. Unset
`POSTGRES_SUPERUSER` to skip the step.

> **IMPORTANT: Reindex when upgrading an existing volume.**
> `pgvector/pgvector:pg17` is glibc-based. `postgres:17-alpine` was musl-based.
> musl and glibc order text differently so every B-tree index on a text column
> is potentially invalid against the new image.
>
> **Reindexing is not automatic, this must be applied manually**
> After the first start on the new image run the following:
>
> ```sh
> docker compose exec <db-image> \
>   psql -U "$POSTGRES_USER" -d "$APP_DB_NAME" -c "REINDEX SYSTEM \"$APP_DB_NAME\";"
> docker compose exec <db-image> \
>   psql -U "$POSTGRES_USER" -d "$APP_DB_NAME" -c "REINDEX DATABASE \"$APP_DB_NAME\";"
> ```

**Embedding server.** The `embedder` service runs HuggingFace Text Embeddings
Inference. The default model is `BAAI/bge-large-en-v1.5` (1024 dimensions,
512-token context, English). Weights are ~1.3GB and are downloaded on first boot
into the `embedder_models` volume.

TEI does not bind its port until the model is warm — roughly 40s on CPU with
weights already cached, and considerably longer on a first boot that downloads
them. Nothing answers on `/health` before that, which is why the service carries
no healthcheck and why `TeiEmbedder.connect()` retries `/info` for up to two
minutes before giving up.

Give `BAAI/bge-large-en-v1.5` **at least 4GB**. fp32 weights are ~1.3GB, but TEI
peaks near double that while materializing tensors during load.

| env var | default | read by | meaning |
| ------- | ------- | ------- | ------- |
| `EMBEDDER_BASE_URL`        | `http://embedder:80`     | `app`      | where the app reaches the server |
| `EMBEDDER_MODEL`           | `BAAI/bge-large-en-v1.5` | `embedder` | the server's `--model-id` |
| `EMBEDDER_MAX_BATCH_TOKENS`| `4096`                   | `embedder` | token budget for one inference batch |

`EMBEDDER_MAX_BATCH_TOKENS` is a memory knob, not a throughput one. TEI
allocates against it during warmup, so it is part of what the 4GB limit above
has to absorb. The stock default of 16384 sizes activation buffers for a GPU and
is wasted on CPU. The value is chosen to match the largest batch this deployment
can actually form:

```
max_input_length     512    # bge-large's context
max_batch_requests   8      # CPU backend limit, discovered at warmup
                     ----
                     4096   # 8 x 512, the real ceiling
```

`max_batch_requests` is not configurable — TEI derives it while warming the
model.

Do not confuse this with `max_client_batch_size` (32), which is how many inputs
one HTTP request may carry. That one is the client's concern, and `TeiEmbedder`
discovers it and chunks to it automatically.

Swapping `EMBEDDER_MODEL` for something the deployment cannot use is refused
rather than documented and hoped for. `connect()` throws so no embedder is ever
handed out. Changing `EMBEDDER_MODEL` invalidates every stored vector because
vectors from different models do not share coordinate space

The refusals are covered by an integration suite that runs against the live
server rather than a stub:

```sh
npm run test:integration --workspace=packages/embedding
```

It needs the `embedder` service up, and finds it via the container's IP on the
compose network (override with `TEST_EMBEDDER_BASE_URL`).

## Running

### With Docker Compose (production)

```sh
docker compose up --build
```

This starts:
- **app** -- Node.js server on port 3000 (internal)
- **nginx** -- Gateway serving the SPA and proxying `/api`, on `127.0.0.1:8080` (HTTP; sits behind the host's TLS-terminating nginx)
- **postgres** -- PostgreSQL 17 + pgvector
- **embedder** -- self-hosted embedding server (internal)
- **parser** -- background file-parsing worker
- **migrate** -- one-shot migration runner, exits after applying pending migrations

The database is automatically bootstrapped with the application role, the
required extensions, and migrations on first run.

### Local development

```sh
npm run build
npm run dev --workspace=packages/aim_hi_webserver
```

Note: for local development you will need a running PostgreSQL instance and the corresponding `PG*` environment variables set (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`).

## Build

```sh
# Build all packages
npm run build

# Build individual packages
npm run build:chatbot
npm run build:webserver
```
