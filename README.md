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
  nginx/             # Gateway nginx config
  systemd/           # Unit template the server installer fills in
scripts/             # Env and secret generators, bundle and install scripts
```

## Setup

### 1. Install dependencies

```sh
npm install
```

The frontend is not a root workspace. It installs and builds independently
against its own lockfile, the same way its Docker stage does:

```sh
cd packages/aim_hi_fe && npm ci
```

### 2. Configure environment and secrets

Non-secret configuration is written in `config/docker/config.json` and rendered
into the env file Docker Compose reads. Secret values are **not** kept there.
They are mounted into the containers as files via Docker Compose `secrets:`
(see below), which keeps them out of `docker inspect`, `/proc/<pid>/environ`,
child-process env, and crash logs.

Two profiles are committed under `config/docker/`: `local.json` is the developer
stack (mock auth, debug traces, no rate limits, `localhost`) and
`production.json` is the real one. Render the one you want into the `.env`
file; the profile is always named, so a stack is never generated from the
wrong one by accident:

```sh
node scripts/gen_env.mjs local               # writes ./.env for the developer stack
node scripts/gen_env.mjs production          # writes ./.env for production
node scripts/gen_env.mjs local --force       # overwrite an existing .env
```

Machine-specific values, such as the model endpoint, go in
`config/docker/override.json`, which is gitignored and merged over the chosen
profile key by key.

Each key maps onto one variable in `docker-compose.yml`. A `null` value leaves
that variable unset, so the compose default applies. A `null` in the override
unsets a value the profile set. The sections are:

| section | what it configures |
| --- | --- |
| `anthropic` | the API endpoint the chatbot targets (the key itself is a secret) |
| `postgres` | the superuser, app role and database names (passwords are secrets) |
| `app` | `auth_mode` and `model_mode`, each `real` or `mock`: mock auth seeds `testuser` and accepts any password; the mock model gives canned replies. `debug_mode` adds a `debug` trace (model rounds, tool calls, tokens) to Ally replies. Also the upload path and proxy trust |
| `nginx`, `frontend` | the public hostname, and the frontend's base and API paths |
| `secrets_dir` | where compose reads the secret files (see below) |
| `sources` | `knowledge` and `prompts`: the host directories the app reads the knowledge base and the bots' prompts from on startup, normally the two directories of the `packages/static` submodule |
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

TLS is terminated by a reverse proxy on the host, which proxies to the
gateway container on `127.0.0.1:8080` (plain HTTP). What that proxy must set
is listed under [Reverse proxy](#reverse-proxy) below.

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

### With Docker Compose

```sh
docker compose up --build
```

This starts the stack:
- **app** -- Node.js server on port 3000 (internal)
- **parser** -- extracts text from uploaded files
- **nginx** -- Gateway serving the SPA and proxying `/api`, on `127.0.0.1:8080` (HTTP; sits behind a TLS-terminating reverse proxy)
- **postgres** -- PostgreSQL 17 database

The database is automatically bootstrapped with the application role and
migrations on first run. On a server, use the installer below instead of
running compose by hand.

### Local development

```sh
npm run build
npm run dev --workspace=packages/aim_hi_webserver
```

Note: for local development you will need a running PostgreSQL instance and the corresponding `PG*` environment variables set (`PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`).

## Installing on a server

The server builds the images from source and runs the stack as a systemd
service. It needs Docker with the compose plugin, systemd, and root. Nothing
else: Node is not required on the server, and no git access is needed because
the source arrives as a tarball.

### 1. Bundle

On your machine, with the submodules checked out:

```sh
scripts/bundle.sh                 # writes build/aim-hi-<sha>.tar.gz
scp build/aim-hi-*.tar.gz server:
```

The bundle holds every tracked file of the root and the four submodules, and
a `BUNDLE` file naming the commits inside. Secrets, `.env`, `override.json`
and `node_modules` are never packed. The script warns when the working tree
is dirty, since uncommitted edits to tracked files do get packed.

### 2. Install

On the server:

```sh
tar xzf aim-hi-<sha>.tar.gz -C /opt
cd /opt/aim-hi
sudo scripts/install.sh
```

The installer asks for the public hostname, the URL prefix the app is served
under (default `/`), the model endpoint, its API key, and an optional first
login. Then it builds the images, installs and starts the `aim-hi` service,
and creates that login. It refuses to run a stack whose rendered env has
anything but `AUTH_MODE=real`.

What it leaves behind:

| path | what |
| --- | --- |
| `config/docker/override.json` | this site's values, merged over the production profile |
| `/etc/aim-hi/secrets/` | the four secret files (see [Secrets](#secrets)) |
| `.env` | rendered from the profile plus override; regenerated on every run |
| `/etc/systemd/system/aim-hi.service` | the unit, filled in from `config/systemd/aim-hi.service` |

Every answer can be given as an environment variable instead, which is also
how a non-interactive install works. The variables are listed at the top of
`scripts/install.sh`.

### 3. Operate

```sh
systemctl status aim-hi           # state of the service
systemctl restart aim-hi          # stop and start the stack
docker compose ps                 # each container's state (run in /opt/aim-hi)
docker compose logs -f app        # application log
scripts/inject_user.sh <username> <email>   # another login, or a password reset
```

The service is a thin shell around compose: start runs `docker compose up -d
--wait` and fails if any container does not become healthy, stop runs
`docker compose down`. Data lives in the `postgres_data` and `uploads`
volumes, which a stop or restart never touches.

### 4. Update

Make a new bundle, unpack it over the same directory, and run the installer
again:

```sh
tar xzf aim-hi-<sha>.tar.gz -C /opt
cd /opt/aim-hi
sudo scripts/install.sh
```

Existing site values and secrets are kept and not asked for again. The
images are rebuilt and the service restarted, which applies any new
migrations. The same works from a git checkout: pull, update the submodules,
and re-run the installer there.

### Migrating a stack started by hand

Compose names its project, and so its volumes, after the directory it was
started from. Running the installer in that same directory simply adopts the
stack: secrets and data are reused and only changed containers are
recreated.

Running it from a new directory makes a new, empty project. The installer
detects the old one, and offers to stop it and copy its database, uploads
and secret files into the new install (`AIM_HI_MIGRATE=y` when there is no
terminal). The old volumes are kept until you remove them; the installer
prints the command. It refuses to proceed while an old stack still holds
port 8080 and no migration was chosen.

### Reverse proxy

The gateway listens on `127.0.0.1:8080` only, so the app is unreachable
until a TLS-terminating reverse proxy on the host fronts it. The installer
does not touch your proxy. With nginx, a location along these lines is
enough:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 25m;
    proxy_read_timeout 300s;
}
```

What matters in it:

- `client_max_body_size 25m` matches the gateway's upload limit.
- `proxy_read_timeout 300s` or more, so long model requests are not cut off
  at the edge.
- TLS is not optional. The session cookie is marked `Secure`, so a browser
  only sends it over HTTPS and a plain-HTTP site cannot log in. Terminate
  TLS in the proxy and redirect HTTP to HTTPS there.
- Streamed bot replies carry `X-Accel-Buffering: no`, which nginx honours on
  its own. Do not add that header to `proxy_ignore_headers`.
- The production profile sets `TRUST_PROXY=2`: your proxy plus the gateway.
  Add one per extra trusted hop (a CDN, say) via `app.trust_proxy` in
  `override.json`, and do not raise it beyond the proxies you control, since
  it makes the app honour `X-Forwarded-For`.

To serve the app under a prefix, give that prefix as the URL path at install
time (for example `/aimhi/`); the frontend is built for it. The proxy then
strips the prefix before passing the request on, which the trailing slash on
`proxy_pass` does:

```nginx
location /aimhi/ {
    proxy_pass http://127.0.0.1:8080/;
    # ...the same headers and limits as above
}
```

## Build

```sh
# Build all packages
npm run build

# Build individual packages
npm run build:chatbot
npm run build:webserver
```
