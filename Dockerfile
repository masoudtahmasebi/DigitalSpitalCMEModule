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
#   backup   the api image plus pg_dump; runs on a timer, not a port
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
# `pnpm fetch` reads the lockfile, so the layer is primed without knowing which
# projects exist and a new workspace package can never again be forgotten here.
# `--offline` afterwards proves the fetch was complete rather than silently
# reaching for the network.
#
# ## Why `package.json` and `pnpm-workspace.yaml` are copied beside the lockfile
#
# Because without it `pnpm fetch` fetches **nothing**, and says "Already up to
# date" while doing it.
#
# The lockfile's packages hang off its `importers` — one per workspace project.
# `pnpm-workspace.yaml` is what tells pnpm this directory *is* a workspace root
# and which projects to expect; absent, pnpm sees a lone lockfile with no
# projects to satisfy, concludes there is nothing to do, and exits 0 with a
# 2 MB store instead of a 339 MB one. The failure lands one layer later, on the
# first package the install wants:
#
#     ERR_PNPM_NO_OFFLINE_TARBALL  A package is missing from the store but
#     cannot download it in offline mode … helmet-8.3.0.tgz
#
# — which reads as a broken lockfile or a network problem, and is neither.
#
# `package.json` is copied for a different reason and is just as load-bearing:
# it carries `packageManager`, and **corepack reads it to decide which pnpm to
# use**. Without it corepack has nothing to pin to and downloads whatever is
# latest — which is how one build got pnpm 10.33 and another, from the same
# commit, got pnpm 11.20 with a differently laid-out store. The comment on
# `corepack enable` below claims the image cannot drift; only this makes it
# true.

# ---------------------------------------------------------------------------
# deps — the workspace, installed once
# ---------------------------------------------------------------------------
FROM node:22-bookworm-slim AS deps

# corepack ships with Node and pins pnpm from `packageManager` in package.json,
# so an image cannot drift to a different pnpm than CI used.
RUN corepack enable

# There is no human at this terminal, and pnpm needs telling.
#
# `pnpm fetch` populates `node_modules/.pnpm` before `COPY . .` lands the
# workspace on top of it. pnpm 10 then sees a modules directory whose
# `.modules.yaml` does not describe the install it is about to perform, wants to
# remove it, and — finding no TTY to ask on — **aborts**:
#
#     ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY
#     Aborted removal of modules directory due to no TTY
#
# `CI=true` is pnpm's own documented answer and is true by construction here: a
# container build has no interactive session, so every prompt is a hang or an
# abort. It also settles turbo's output into plain lines rather than a TUI that
# renders as escape codes in a deployment log.
ENV CI=true

WORKDIR /repo

# Three files, each for its own reason (see the header): the lockfile carries
# the packages, `pnpm-workspace.yaml` makes pnpm look for importers at all, and
# `package.json` pins the pnpm version corepack fetches. Only these three, so a
# source-only change still reuses this layer.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./

# Fetch, then prove it fetched something.
#
# The guard exists because the failure it catches is *silent*: `pnpm fetch` with
# no workspace file prints "Already up to date", exits 0, and leaves a store
# with a few megabytes of nothing in it. The build then runs on for another
# layer before failing with a message about one missing tarball, which points
# at the package rather than at the fetch.
#
# A plain file count over the whole store, not a count of a particular path
# inside it. The first version of this guard looked for `*/index/*.json`, which
# is the v10 store's layout — and promptly failed a build whose corepack had
# picked pnpm 11, whose store is laid out differently. It reported "0 packages"
# about a store holding 597 of them.
#
# That is the exact failure mode the guard exists to prevent, produced by the
# guard. So it now asserts the only thing it actually needs to know — that the
# store is not empty — in terms no store version can change: a real fetch leaves
# ~21,000 files, an empty one leaves 0, and 100 sits between them with room for
# either to move a long way.
RUN pnpm fetch && \
    files="$(find "$(pnpm store path)" -type f | wc -l)" && \
    if [ "$files" -lt 100 ]; then \
      echo "pnpm fetch left ${files} files in the store — it fetched nothing." >&2; \
      echo "pnpm-lock.yaml, pnpm-workspace.yaml and package.json must all be" >&2; \
      echo "copied before this runs; without the workspace file fetch has no" >&2; \
      echo "importers to resolve and reports success having done nothing." >&2; \
      exit 1; \
    fi

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

# The commit, for the widget alone (P46-01).
#
# The console and the portal learn theirs at *container start*, from
# `ds-runtime-config.sh`, which is why one image of each runs in any
# environment. The widget has no such channel: it is a single `.js` file served
# by nginx and loaded into somebody else's page, with no `/config.js` beside it.
#
# Baking it in is nevertheless correct here, and does not reintroduce the
# environment-specific image P16-02 removed — a commit is a property of the
# *build*, not of the environment it runs in. Two deployments of the same commit
# still get byte-identical bundles.
#
# Defaults to empty so a bare `docker build` works; the element then reports
# `unknown`, which is the honest answer.
ARG DS_COMMIT=""
ENV DS_COMMIT=$DS_COMMIT

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

# The development Keycloak stub does not ship (P52-02).
#
# `pnpm deploy` above copies the whole compiled `dist/`, so without this line
# the image contains a program that mints a signed bearer token for any subject
# asked of it. It refuses to start under NODE_ENV=production and this stage
# sets exactly that — but a defence that depends on one environment variable
# staying set is not one to rely on alone for a token minter, and the honest
# thing is for the file not to be there at all.
#
# `USER node` is already in effect and owns these paths, so this needs no
# privilege. Deliberately not `rm -f`: if the build layout ever changes so that
# this file is somewhere else, the build should fail loudly here rather than
# quietly start shipping it again.
RUN rm ./dist/dev-keycloak.js ./dist/dev-keycloak.js.map 2>/dev/null || rm ./dist/dev-keycloak.js

# The API serves HTTP; TLS is Caddy's job (see infra/deploy).
EXPOSE 3000

# No HEALTHCHECK here: the compose file defines one, compose's wins, and two
# definitions of the same probe is one of them silently going stale.

# No shell form: `node` becomes PID 1 and receives SIGTERM directly, so a
# rolling deploy drains rather than being killed after the stop timeout.
#
# Three other entrypoints ship in the same image and are run with
# `--entrypoint node`, never as the default:
#
#   dist/db-migrate.js       apply migrations as ds_migrator
#   dist/bootstrap-admin.js  create the first super administrator, once
#   dist/seed-ds-default.js  create the default DS customer (P26-01) — the one
#                            seed deploy.sh runs by itself, with --if-missing
#   dist/seed-ds.js          create the DS test tenant, on request (P20-01)
#   dist/seed-medice.js      create the MEDICE ADHS course (P24-02)
#
# They live here rather than in a separate tools image because they must be
# built from the same commit as the API — a migrator one commit ahead of the
# schema it migrates is the failure this arrangement exists to prevent.
CMD ["node", "dist/main.js"]

# ---------------------------------------------------------------------------
# backup — the same code, plus the one binary it needs
# ---------------------------------------------------------------------------
#
# ## Why a separate image and not the API's
#
# `pg_dump` has to read every row, and `ds_app` cannot: FORCE ROW LEVEL
# SECURITY applies to it like anyone else, so a dump taken with the API's
# credentials would be silently partial and would exit 0. The backup therefore
# needs a credential the API deliberately does not hold — which means it cannot
# be a thread in the API container, however convenient that would be.
#
# ## Why `FROM api` and not another `FROM node`
#
# It is the same compiled code. Rebuilding it would be a second copy that could
# drift from the one being backed up, and the layer is already on the host.
# The delta is `postgresql-client` — about 25 MB — and that is the whole image.
#
# **The client's major version must be at least the server's.** `pg_dump` from
# 15 against a 16 server refuses with "server version mismatch"; the other way
# round is fine. Pinned to 16 to match `postgres:16-alpine` in the compose file,
# and the two have to move together.
FROM api AS backup

USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-16 \
    && rm -rf /var/lib/apt/lists/*
USER node

# No CMD that runs on its own. This image does nothing until something asks it
# to — `docker compose run --rm backup database`, from a systemd timer — and a
# default that took a backup on `docker compose up` would take one on every
# deploy, at the worst possible moment.
ENTRYPOINT ["node", "dist/backup/cli.js"]

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
