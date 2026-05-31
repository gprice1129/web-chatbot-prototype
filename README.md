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

### 2. Configure environment variables

Create a `.env` file in the project root:

```env
# Anthropic (the endpoint the chatbot targets + its credential)
ANTHROPIC_BASE_URL=https://api.anthropic.com
ANTHROPIC_BASE_URL_API_KEY=your-api-key

# Postgres superuser (used only during initial DB setup)
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your-superuser-password

# Application database
APP_DB_USER=app
APP_DB_PASSWORD=your-app-db-password
APP_DB_NAME=chatbot

# Nginx
SERVER_NAME=your.domain.com
SSL_CERT_FILE=cert.pem
SSL_KEY_FILE=key.pem
```

### 3. Add SSL certificates

Place your SSL certificate and key in `config/nginx/certs/`, matching the filenames set in `SSL_CERT_FILE` and `SSL_KEY_FILE`.

## Running

### With Docker Compose (production)

```sh
docker compose up --build
```

This starts three services:
- **app** -- Node.js server on port 3000 (internal)
- **nginx** -- Reverse proxy exposing ports 80 (redirects to HTTPS) and 443
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
