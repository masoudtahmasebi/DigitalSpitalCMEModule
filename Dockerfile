# Every image, from one file (P18-01).
#
# ## Why one file and not four
#
# There were four Dockerfiles, one per app, and each began with the same seven
# lines: pull Node, enable corepack, `pnpm fetch`, copy the workspace, `pnpm
# install`. That is fine on a CI runner with a warm layer cache and four
# parallel jobs. It is not fine on the deployment host, which is where the
# images are built now (ADR-0013): four builds means the monorepo is installed
# up to four times on a 4-vCPU box, and three of those installs produce exactly
# the same layers as the first.
#
# Here the install happens **once**, in `deps`, and everything else starts from
# it. The three frontends are additionally built in **one** turbo invocation
# rather than three, which matters because `@ds/portal` depends on `@ds/widget`
# — built separately, the widget is compiled twice, and the second copy is the
# one that has to be byte-identical to the first (see scripts/bundle-widget.mjs).
#
# ## The targets
#
#   api      NestJS, production dependency tree only
#   admin    the console, static, behind nginx
#   portal   the learner portal, static, behind nginx
#   widget   ds-lms.js, static, behind nginx, CORS-enabled
#
# `docker build --target api .`, or `target:` in the compose file.
#
# ## Why the whole workspace is copied
#
# `@ds/api` depends on six workspace packages. A build that copied only
# `apps/api` would fail at install, and one that vendored the packages would
# build something subtly different from what CI tested. Turborepo builds the
# dependency graph in the right order.
#
# ## Why `pnpm fetch` rather than a list of manifests
#
# The install layer used to be primed by copying each workspace `package.json`
# by hand — eleven `COPY` lines, repeated across all four Dockerfiles.
# `packages/mail` and `packages/plugin-api` were added later and nobody
# extended the lists. `pnpm install` still *succeeded* — it happily writes a
# symlink to a directory that is not there yet — and the missing projects'
# dependencies were simply never installed. The failure surfaced two stages
# later as `error TS2307: Cannot find module 'nodemailer'`, which reads as a
# source problem rather than a Dockerfile one.
#
# `pnpm fetch` needs only the lockfile. It populates the store with everything
# the lockfile names, so the layer is primed without knowing which projects
# exist, and a new workspace package can never again be forgotten here.
# `--offline` afterwards proves the fetch was complete rather than silently
# reaching for the network.

# ---------------------------------------------------------------------------
# deps — the workspace, installed once
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps

# corepack ships with Node and pins pnpm from `packageManager` in package.json,
# so an image cannot drift to a different pnpm than CI used.
RUN corepack enable

WORKDIR /repo

# The lockfile alone primes the store, so a source-only change reuses this
# layer and no workspace project can be left out of it.
COPY pnpm-lock.yaml ./
RUN pnpm fetch

COPY . .

RUN pnpm install --offline --frozen-lockfile

# ---------------------------------------------------------------------------
# build-api — compile, then a production-only tree
# ---------------------------------------------------------------------------
FROM deps AS build-api

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
RUN pnpm --filter @ds/api --prod --node-linker=hoisted --legacy deploy /app-runtime

# ---------------------------------------------------------------------------
# build-web — all three frontends, one turbo run
# ---------------------------------------------------------------------------
# Together rather than separately because `@ds/portal` depends on `@ds/widget`:
# one invocation builds the widget once and copies that exact artifact into the
# portal's `public/`. Three invocations build it twice and rely on the second
# being identical to the first.
FROM deps AS build-web

RUN pnpm --filter @ds/admin... --filter @ds/portal... --filter @ds/widget... build

# ---------------------------------------------------------------------------
# api — the runtime
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS api

ENV NODE_ENV=production
# Node's own default is unbounded, which in a container means the OOM killer
# decides. This keeps the failure inside Node where it is diagnosable.
ENV NODE_OPTIONS=--max-old-space-size=512

# `node` (uid 1000) ships with the image. Running as root in a container that
# holds database credentials is not a default worth accepting.
USER node
WORKDIR /app

COPY --from=build-api --chown=node:node /app-runtime ./

# The SQL the compiled migrator reads. Baked in rather than mounted, so the
# image and the schema it expects travel together — a container can never be
# run against migrations from a different commit.
COPY --from=build-api --chown=node:node /repo/db/migrations ./dist/migrations

# The API serves HTTP; TLS is Caddy's job (see infra/deploy).
EXPOSE 3000

# No HEALTHCHECK here: the compose file defines one, compose's wins, and two
# definitions of the same probe is one of them silently going stale.

# No shell form: `node` becomes PID 1 and receives SIGTERM directly, so a
# rolling deploy drains rather than being killed after the stop timeout.
#
# Two other entrypoints ship in the same image and are run with
# `--entrypoint node`, never as the default:
#
#   dist/db-migrate.js       apply migrations as ds_migrator
#   dist/bootstrap-admin.js  create the first super administrator, once
#
# They live here rather than in a separate tools image because they must be
# built from the same commit as the API — a migrator one commit ahead of the
# schema it migrates is the failure this arrangement exists to prevent.
CMD ["node", "dist/main.js"]

# ---------------------------------------------------------------------------
# admin — the console
# ---------------------------------------------------------------------------
# A static SPA, so the runtime is a web server with files in it: no Node, no
# dependency tree, nothing that needs patching monthly.
#
# The image carries **no hostname**. Everything it needs to know — which API,
# which project — is read from `/config.js`, written when the container starts
# (P16-02), so the same image is deployable to any environment.
FROM nginx:1.27-alpine AS admin
COPY --from=build-web /repo/apps/admin/dist /usr/share/nginx/html
COPY infra/nginx/admin.conf /etc/nginx/conf.d/default.conf

# nginx's own entrypoint runs everything in this directory before starting the
# server, so /config.js exists before the first request can ask for it. It
# exits non-zero on a missing DS_API_BASE, which stops the container — louder,
# and noticed sooner, than a page that loads and then fails every request.
COPY infra/nginx/ds-runtime-config.sh /docker-entrypoint.d/20-ds-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/20-ds-runtime-config.sh
EXPOSE 80

# ---------------------------------------------------------------------------
# portal — the standalone learner frontend
# ---------------------------------------------------------------------------
# Ships `ds-lms.js` alongside its own bundle: the widget is loaded from this
# origin rather than from the widget host, so a learner's browser makes no
# cross-origin request to start a Fortbildung.
FROM nginx:1.27-alpine AS portal
COPY --from=build-web /repo/apps/portal/dist /usr/share/nginx/html
COPY infra/nginx/portal.conf /etc/nginx/conf.d/default.conf
COPY infra/nginx/ds-runtime-config.sh /docker-entrypoint.d/20-ds-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/20-ds-runtime-config.sh
EXPOSE 80

# ---------------------------------------------------------------------------
# widget — ds-lms.js, for a host that would rather not ship it
# ---------------------------------------------------------------------------
# The WordPress plugin can ship `assets/ds-lms.js` itself, and for MEDICE it
# does. This image is for the other case: a customer whose site should load the
# widget from a URL we control, so a fix reaches them without them redeploying
# a plugin. Consequently the one thing that matters here is CORS — the script
# is fetched cross-origin by definition, and `widget.conf` sets the headers.
FROM nginx:1.27-alpine AS widget
COPY --from=build-web /repo/apps/widget/dist /usr/share/nginx/html
COPY infra/nginx/widget.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
