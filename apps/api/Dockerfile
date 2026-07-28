# The API image (P10-04).
#
# Multi-stage, because the build needs pnpm, the whole workspace and every
# devDependency, and the runtime needs none of them. What ships is Node, the
# production dependency tree and compiled JavaScript.
#
# ## Why the whole workspace is copied for the build
#
# `@ds/api` depends on `@ds/domain`, `@ds/sdk` and `@ds/eiv-client` as workspace
# packages. A Dockerfile that copied only `apps/api` would fail at install, and
# one that vendored the packages would build something subtly different from
# what CI tested. Turborepo builds the dependency graph in the right order.

# ---------------------------------------------------------------------------
# Stage 1 — install and build
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

# corepack ships with Node and pins pnpm from packageManager in package.json,
# so the image cannot drift to a different pnpm than CI used.
RUN corepack enable

WORKDIR /repo

# Manifests first, so a source-only change reuses the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json                 apps/api/
COPY apps/admin/package.json               apps/admin/
COPY apps/portal/package.json              apps/portal/
COPY apps/widget/package.json              apps/widget/
COPY apps/eiv-harness/package.json         apps/eiv-harness/
COPY packages/domain/package.json          packages/domain/
COPY packages/sdk/package.json             packages/sdk/
COPY packages/eiv-client/package.json      packages/eiv-client/
COPY packages/oidc/package.json            packages/oidc/
COPY packages/config/package.json          packages/config/

RUN pnpm install --frozen-lockfile

COPY . .

# Only what the API needs; the frontends are built by their own images.
RUN pnpm --filter @ds/api... build

# A second, production-only install. `--prod` prunes devDependencies, and
# `--node-linker=hoisted` produces a plain node_modules the runtime stage can
# copy without pnpm's symlink store.
RUN pnpm --filter @ds/api... --prod --node-linker=hoisted deploy /app-runtime

# ---------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production
# Node's own default is unbounded, which in a container means the OOM killer
# decides. This keeps the failure inside Node where it is diagnosable.
ENV NODE_OPTIONS=--max-old-space-size=512

# `node` (uid 1000) ships with the image. Running as root in a container that
# terminates TLS-adjacent traffic and holds database credentials is not a
# default worth accepting.
USER node
WORKDIR /app

COPY --from=build --chown=node:node /app-runtime ./

# The SQL the compiled migrator reads. Baked in rather than mounted, so the
# image and the schema it expects travel together — a container can never be
# run against migrations from a different commit.
COPY --from=build --chown=node:node /repo/db/migrations ./dist/migrations

# The API serves HTTP; TLS is Caddy's job (see infra/deploy).
EXPOSE 3000

# No shell form: `node` becomes PID 1 and receives SIGTERM directly, so a
# rolling deploy drains rather than being killed after the stop timeout.
CMD ["node", "dist/main.js"]
