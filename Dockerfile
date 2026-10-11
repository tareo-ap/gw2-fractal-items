# Multi-stage build: stage 1 compiles everything, stage 2 copies only the results into a small image.
# Stage 1: install dependencies and build everything
FROM node:24-slim AS build
WORKDIR /app
# Copy the package files first so Docker caches the dependency layer until they change.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY tsconfig.base.json ./
COPY shared shared
COPY server server
COPY web web
RUN npm run build

# Stage 2: slim runtime image with production dependencies only
FROM node:24-slim
WORKDIR /app
# Defaults of the server; DB_PATH lies on the /data volume so the SQLite file survives.
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/data/gw2-items.db \
    WEB_DIST=/app/web/dist \
    UPDATE_CHECK=on
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace server && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
# Run as the unprivileged "node" user, which must own the volume directory.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000
WORKDIR /app/server
CMD ["node", "dist/server/src/index.js"]
