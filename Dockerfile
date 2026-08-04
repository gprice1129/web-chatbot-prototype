ARG FE_PACKAGE=aim_hi_fe
ARG FE_DIST_DIR=dist

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/aim_hi_webserver/package.json packages/aim_hi_webserver/package.json
COPY packages/aim_hi_chatbot/package.json packages/aim_hi_chatbot/package.json
COPY packages/job_queue/package.json packages/job_queue/package.json
COPY packages/parser/package.json packages/parser/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/embedding/package.json packages/embedding/package.json
COPY packages/file_storage/package.json packages/file_storage/package.json

RUN npm ci

# Every package the root tsconfig.json references must be present: `npm run
# build` causes `tsc -b` to be run over the project graph. A missing package 
# causes a build failure.
COPY tsconfig.json tsconfig.base.json ./
COPY packages/aim_hi_webserver packages/aim_hi_webserver
COPY packages/aim_hi_chatbot packages/aim_hi_chatbot
COPY packages/job_queue packages/job_queue
COPY packages/parser packages/parser
COPY packages/db packages/db
COPY packages/embedding packages/embedding
COPY packages/file_storage packages/file_storage

RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ARG FILES_BASE_PATH=/var/lib/aim_hi/uploads

COPY package.json package-lock.json ./
COPY packages/aim_hi_webserver/package.json packages/aim_hi_webserver/package.json
COPY packages/aim_hi_chatbot/package.json packages/aim_hi_chatbot/package.json
COPY packages/job_queue/package.json packages/job_queue/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/file_storage/package.json packages/file_storage/package.json
COPY --from=build /app/packages/aim_hi_webserver/build packages/aim_hi_webserver/build
COPY --from=build /app/packages/aim_hi_chatbot/build packages/aim_hi_chatbot/build
COPY --from=build /app/packages/job_queue/build packages/job_queue/build
COPY --from=build /app/packages/db/build packages/db/build
COPY --from=build /app/packages/file_storage/build packages/file_storage/build

RUN npm ci --omit=dev

# Create the uploads mount point owned by the unprivileged `node` user so the
# named volume inherits node ownership on first init — a root-owned volume
# would be unwritable once we drop privileges with USER below.
RUN mkdir -p "$FILES_BASE_PATH" && chown node:node "$FILES_BASE_PATH"

WORKDIR /app/packages/aim_hi_webserver
EXPOSE 3000
USER node
ENTRYPOINT ["node", "build/main.js"]

FROM node:24-bookworm-slim AS parser
WORKDIR /app
ENV NODE_ENV=production
ARG FILES_BASE_PATH=/var/lib/aim_hi/uploads

COPY package.json package-lock.json ./
COPY packages/job_queue/package.json packages/job_queue/package.json
COPY packages/parser/package.json packages/parser/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/file_storage/package.json packages/file_storage/package.json
COPY --from=build /app/packages/job_queue/build packages/job_queue/build
COPY --from=build /app/packages/parser/build packages/parser/build
COPY --from=build /app/packages/db/build packages/db/build
COPY --from=build /app/packages/file_storage/build packages/file_storage/build

RUN npm ci --omit=dev

# Same as the runtime stage: own the uploads mount point as node before
# dropping privileges, since the parser writes parsed text into the volume.
RUN mkdir -p "$FILES_BASE_PATH" && chown node:node "$FILES_BASE_PATH"

WORKDIR /app/packages/parser
USER node
ENTRYPOINT ["node", "build/main.js"]

FROM node:24-bookworm-slim AS fe-build
ARG FE_PACKAGE
ARG FE_DIST_DIR
# Asset/router base
ARG VITE_BASE_PATH=/
# API base
ARG VITE_API_URL=/api
WORKDIR /app
COPY packages/${FE_PACKAGE} .
RUN npm ci
RUN VITE_BASE_PATH="$VITE_BASE_PATH" VITE_API_URL="$VITE_API_URL" npm run build
RUN mv ${FE_DIST_DIR} /fe-dist

FROM nginx:1.27-alpine AS gateway
COPY --from=fe-build /fe-dist /usr/share/nginx/html
COPY config/nginx/nginx.conf /etc/nginx/nginx.conf
COPY config/nginx/templates /etc/nginx/templates
