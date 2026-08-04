# The API image (P10-04).
#
# Multi-stage, because the build needs pnpm, the whole workspace and every
# devDependency, and the runtime needs none of them. What ships is Node, the
# production dependency tree and compiled JavaScript.
#
# ## Why the whole workspace is copied for the build
#
# `@ds/api` depends on six workspace packages. A Dockerfile that copied only
# `apps/api` would fail at install, and one that vendored the packages would
# build something subtly different from what CI tested. Turborepo builds the
# dependency graph in the right order.
#
# ## Why `pnpm fetch` rather than a list of manifests
#
# The install layer used to be primed by copying each workspace `package.json`
# by hand — eleven `COPY` lines, one per project, repeated across all four
# Dockerfiles. `packages/mail` and `packages/plugin-api` were added later and
# nobody remembered to extend the lists. The consequences were quiet in exactly
# the wrong way: `pnpm install` still *succeeded*, because it happily writes a
# symlink to a directory that is not there yet, and the missing projects'
# own dependencies were simply never installed. The failure surfaced two
# stages later as
#
#     src/smtp.ts(28,33): error TS2307: Cannot find module 'nodemailer'
#
# which reads as a source problem, not a Dockerfile one. **The API image could
# not be built at all**, and nothing said so until someone tried to deploy,
# because CI never built images.
#
# `pnpm fetch` needs only the lockfile. It populates the store with everything
# the lockfile names, so the install layer is primed without knowing which
# projects exist — and a new workspace package can never again be forgotten
# here. `--offline` afterwards proves the fetch was complete rather than
# silently reaching for the network.

# ---------------------------------------------------------------------------
# Stage 1 — install and build
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

# corepack ships with Node and pins pnpm from packageManager in package.json,
# so the image cannot drift to a different pnpm than CI used.
RUN corepack enable

WORKDIR /repo

# The lockfile alone primes the store, so a source-only change reuses this
# layer and no workspace project can be left out of it.
COPY pnpm-lock.yaml ./
RUN pnpm fetch

COPY . .

RUN pnpm install --offline --frozen-lockfile

# Only what the API needs; the frontends are built by their own images.
RUN pnpm --filter @ds/api... build

# A second, production-only install. `--prod` prunes devDependencies, and
# `--node-linker=hoisted` produces a plain node_modules the runtime stage can
# copy without pnpm's symlink store.
#
# Two things here are easy to get wrong, and both were:
#
#   * **`--filter @ds/api`, without the `...`.** The trailing dots mean "and
#     everything it depends on", which is what `build` above wants and what
#     `deploy` refuses: `ERR_PNPM_CANNOT_DEPLOY_MANY — Cannot deploy more than
#     1 project`. `deploy` resolves the workspace dependencies itself; naming
#     them is not merely redundant but fatal.
#   * **`--legacy`.** From pnpm 10, `deploy` refuses a workspace that has not
#     set `inject-workspace-packages=true`. Setting that would fix the deploy
#     and make every local workspace dependency a hard copy, so an edit in
#     `packages/domain` would stop being visible to `apps/api` until someone
#     re-installed — a bad trade for a flag that exists to avoid it.
#
# Both failures are build-time and total, and neither could be seen from the
# repository: images are built in deploy.yml, which only runs after CI passes.
# `.github/workflows/ci.yml` now builds all four images so this cannot recur.
RUN pnpm --filter @ds/api --prod --node-linker=hoisted --legacy deploy /app-runtime

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
