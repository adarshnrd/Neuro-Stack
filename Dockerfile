# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build
WORKDIR /app

# bcrypt is a native module — build tools are needed if no prebuilt binary matches
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ── Runtime stage ────────────────────────────────────────────────────────────
FROM node:20-bookworm-slim
WORKDIR /app

# git is used by @CREATE_PR (simple-git shells out to it)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY public ./public
COPY context ./context

# Run as the unprivileged built-in user; it owns the writable runtime dirs
RUN mkdir -p logs workspace && chown -R node:node /app
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/index.js"]
