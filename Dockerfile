FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY server ./server
COPY web/src ./web/src
FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=build /app /app
USER node
ENV NODE_ENV=production PORT=8080 NODE_OPTIONS=--max-old-space-size=192
CMD ["node","--import","tsx","server/index.ts"]
