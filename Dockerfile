ARG FE_PACKAGE=aim_hi_fe
ARG FE_DIST_DIR=dist

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/aim_hi_webserver/package.json packages/aim_hi_webserver/package.json
COPY packages/aim_hi_chatbot/package.json packages/aim_hi_chatbot/package.json
COPY packages/aim_hi_jobs/package.json packages/aim_hi_jobs/package.json
COPY packages/parser/package.json packages/parser/package.json
COPY packages/db/package.json packages/db/package.json

RUN npm ci

COPY tsconfig.json tsconfig.base.json ./
COPY packages/aim_hi_webserver packages/aim_hi_webserver
COPY packages/aim_hi_chatbot packages/aim_hi_chatbot
COPY packages/aim_hi_jobs packages/aim_hi_jobs
COPY packages/parser packages/parser
COPY packages/db packages/db

RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/aim_hi_webserver/package.json packages/aim_hi_webserver/package.json
COPY packages/aim_hi_chatbot/package.json packages/aim_hi_chatbot/package.json
COPY packages/aim_hi_jobs/package.json packages/aim_hi_jobs/package.json
COPY packages/db/package.json packages/db/package.json
COPY --from=build /app/packages/aim_hi_webserver/build packages/aim_hi_webserver/build
COPY --from=build /app/packages/aim_hi_chatbot/build packages/aim_hi_chatbot/build
COPY --from=build /app/packages/aim_hi_jobs/build packages/aim_hi_jobs/build
COPY --from=build /app/packages/db/build packages/db/build

RUN npm ci --omit=dev

WORKDIR /app/packages/aim_hi_webserver
EXPOSE 3000
ENTRYPOINT ["node", "build/main.js"]

FROM node:24-bookworm-slim AS parser
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/aim_hi_jobs/package.json packages/aim_hi_jobs/package.json
COPY packages/parser/package.json packages/parser/package.json
COPY packages/db/package.json packages/db/package.json
COPY --from=build /app/packages/aim_hi_jobs/build packages/aim_hi_jobs/build
COPY --from=build /app/packages/parser/build packages/parser/build
COPY --from=build /app/packages/db/build packages/db/build

RUN npm ci --omit=dev

WORKDIR /app/packages/parser
ENTRYPOINT ["node", "build/main.js"]

FROM node:24-bookworm-slim AS fe-build
ARG FE_PACKAGE
ARG FE_DIST_DIR
WORKDIR /app
COPY packages/${FE_PACKAGE} .
RUN npm ci
RUN npm run build
RUN mv ${FE_DIST_DIR} /fe-dist

FROM nginx:1.27-alpine AS gateway
COPY --from=fe-build /fe-dist /usr/share/nginx/html
COPY config/nginx/nginx.conf /etc/nginx/nginx.conf
COPY config/nginx/templates /etc/nginx/templates
