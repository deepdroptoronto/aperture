# syntax=docker/dockerfile:1

# 💎 Aperture Cassette Gateway — production image.
#
#   docker build -t deepdrop/aperture:1.0.0 .
#   docker run --rm -p 3000:3000 deepdrop/aperture:1.0.0
#
# Three stages: compile TypeScript, install production-only dependencies, then a
# non-root runtime image that carries the compiled build and nothing else.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS production-deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:20-alpine AS runtime
ENV NODE_ENV=production \
    PORT=3000
WORKDIR /app

COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist/src ./dist/src
COPY --chown=node:node package.json ./

USER node
EXPOSE 3000

# The gateway answers /health without waking a cassette, so this check never
# loads plugin code.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then((res) => process.exit(res.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/src/server.js"]
