# syntax=docker/dockerfile:1.7

# ---- build stage ----
FROM node:24-alpine AS build
WORKDIR /app

# Sharp ships prebuilt musl binaries for alpine; no native build deps needed
# at build time. We install all deps (incl. dev) so tsc + vite can run.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
RUN npm run build

# ---- runtime stage ----
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# libheif-tools provides heif-convert (HEIC decode) and heif-enc (HEIC
# re-encode) — both feed the runtime's HEIC paths. The libheif runtime
# shared library is pulled in as a transitive dependency. tini is PID 1
# so SIGTERM from `docker stop` reaches node and triggers our graceful
# shutdown.
RUN apk add --no-cache libheif-tools tini

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

USER node
EXPOSE 3000

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/src/server/index.js"]
