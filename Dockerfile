# Mosaic Crochet: one process serves the API (/api) and the built SPA (SPEC §9.1).
# glibc base so the prebuilt better-sqlite3 and @node-rs/argon2 binaries load without a compiler.
# --ignore-scripts: better-sqlite3 ships prebuilds/ but npm would still run node-gyp, which needs
# Python and a compiler that the slim image lacks. Native binaries come from prebuilds and from the
# platform-specific optional dependencies (esbuild, rolldown, tailwind, argon2), none needing scripts.

# --- build: compile the SPA (dist/) and bundle the server (dist-server/) ---
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# --- runtime: production dependencies + build output, run as the unprivileged 'node' user ---
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/mosaic.db \
    STATIC_DIR=/app/dist
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
# App files stay root-owned: the process can read them but not change them.
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 3000
# Slim images ship no curl; Node's fetch does the probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/health`).then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist-server/main.js"]
