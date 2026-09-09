# syntax=docker/dockerfile:1
#
# The demo's application image: the Hono server on Bun with the built client
# beside it (`demo-infrastructure` D2). Two stages on one base — the build stage
# carries the devDependencies and the Vite toolchain, the runtime stage carries
# neither.
#
# Built on the box, from the checkout, never pushed: there is no CI, no registry
# and one box (D2). Compose builds before it swaps containers, so the old stack
# serves through the build.
#
#   docker compose -f deploy/demo/compose.yaml build app
#
# The build context is the repository root; the `.dockerignore` there is what
# keeps it to the source.

# Pinned exactly, to the Bun this repository is developed on. A floating
# `oven/bun:1` would move the runtime under a redeploy meant to change one line
# of the app.
FROM oven/bun:1.3.14 AS build
WORKDIR /app

# Manifests first, so the install layer survives every edit that is not a
# dependency change. Three files, two workspaces: `server` and `client` are the
# workspaces the root manifest names — `shared/` is imported by relative path
# and has no manifest of its own.
COPY package.json bun.lock ./
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN bun install --frozen-lockfile

# The source, named rather than `COPY . .`, so the image's contents do not drift
# with whatever else the repository grows. `tsconfig.base.json` is not optional:
# both workspace tsconfigs extend it, and the client's build runs `tsc --noEmit`
# first. `client/test` and `shared/` are in that tsconfig's `include`, so they
# are part of the build whether or not they are part of the output.
COPY tsconfig.base.json ./
COPY shared/ ./shared/
COPY client/ ./client/
COPY server/ ./server/
RUN bun run --filter client build

FROM oven/bun:1.3.14
WORKDIR /app

# **The layout here is load-bearing.** `clientDist` (server/src/static.ts)
# defaults to `<the directory of static.ts>/../../client/dist`, so with the
# server's source at /app/server/src the built client has to be at
# /app/client/dist — and then the deployment needs no MODEL_BROWSER_CLIENT at
# all. `server/src/index.ts` imports `../../shared/types`, which is why
# `shared/` is here too, and `server/tsconfig.json` extends
# `../tsconfig.base.json`.
#
# `server/test` is deliberately not copied: the suites run in the repository,
# not in the deployment.
COPY package.json bun.lock tsconfig.base.json ./
COPY server/package.json server/tsconfig.json ./server/
COPY client/package.json ./client/
COPY shared/ ./shared/
COPY server/src/ ./server/src/
COPY --from=build /app/client/dist/ ./client/dist/

# Runtime dependencies only. The server's are `hono` and `fflate`; `client` is a
# workspace of the same install, so its runtime dependencies (react, three)
# arrive too and are never loaded — 40 MB, measured with this lockfile on
# 2026-09-08. They stay: dropping `client/package.json` to avoid them would
# leave the root manifest naming a workspace that is not there, and the dead
# weight is cheaper than that risk.
RUN bun install --frozen-lockfile --production

# Where this deployment's files are, and the only environment the image sets.
# The configuration is mounted read-only from the checkout (D6); the thumbnail
# and listing caches share one bind mount (D5). MODEL_BROWSER_INDEX is
# deliberately **unset**: the app's default is http://127.0.0.1:8077, which is
# where the index binds, because all three containers share one network
# namespace (D1).
ENV MODEL_BROWSER_CONFIG=/config/config.json \
    MODEL_BROWSER_CACHE=/cache

WORKDIR /app/server
# `index.ts` default-exports a Bun server object, so running the file serves it.
# Its address comes from the mounted configuration's `listen` — loopback, 3177.
CMD ["bun", "src/index.ts"]
