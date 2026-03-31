FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/aim_hi_webserver/package.json packages/aim_hi_webserver/package.json
COPY packages/aim_hi_chatbot/package.json packages/aim_hi_chatbot/package.json

RUN npm ci

COPY tsconfig.json tsconfig.base.json ./
COPY packages/aim_hi_webserver packages/aim_hi_webserver
COPY packages/aim_hi_chatbot packages/aim_hi_chatbot

RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/aim_hi_webserver/package.json packages/aim_hi_webserver/package.json
COPY packages/aim_hi_chatbot/package.json packages/aim_hi_chatbot/package.json
COPY --from=build /app/packages/aim_hi_webserver/build packages/aim_hi_webserver/build
COPY --from=build /app/packages/aim_hi_chatbot/build packages/aim_hi_chatbot/build

RUN npm ci --omit=dev

WORKDIR /app/packages/aim_hi_webserver
EXPOSE 3000
ENTRYPOINT ["node", "build/main.js"]
