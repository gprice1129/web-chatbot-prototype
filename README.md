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

Non-secret configuration is written in `config/docker/config.json` and rendered
into the env file Docker Compose reads. Secret values are **not** kept there.
They are mounted into the containers as files via Docker Compose `secrets:`
(see below), which keeps them out of `docker inspect`, `/proc/<pid>/environ`,
child-process env, and crash logs.

Render the config into the `.env` file:

```sh
node scripts/gen_env.mjs            # writes ./.env
node scripts/gen_env.mjs --force    # overwrite an existing .env
```

Machine-specific values go in `config/docker/config.local.json`, which is
gitignored and merged over `config.json` key by key.

Each key maps onto one variable in `docker-compose.yml`. A `null` value leaves
that variable unset, so the compose default applies. A `null` in the local
file unsets a value the base config set. The sections are:

| section | what it configures |
| --- | --- |
| `anthropic` | the API endpoint the chatbot targets (the key itself is a secret) |
| `postgres` | the superuser, app role and database names (passwords are secrets) |
| `app` | `auth_mode` and `model_mode`, each `real` or `mock`: mock auth seeds `testuser` and accepts any password; the mock model gives canned replies. Also the upload path and proxy trust |
| `nginx`, `frontend` | the public hostname, and the frontend's base and API paths |
| `secrets_dir` | where compose reads the secret files (see below) |
| `knowledge_base` | the markdown corpus the chatbot builds its graph from on startup |
| `rate_limits`, `login_limits` | request limits |
| `models` | per-bot generation parameters; `null` keeps the app's profile defaults |

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

## Running

### With Docker Compose (production)

```sh
docker compose up --build
```

This starts three services:
- **app** -- Node.js server on port 3000 (internal)
- **nginx** -- Gateway serving the SPA and proxying `/api`, on `127.0.0.1:8080` (HTTP; sits behind the host's TLS-terminating nginx)
- **postgres** -- PostgreSQL 17 database

The database is automatically bootstrapped with the application role and migrations on first run.

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
