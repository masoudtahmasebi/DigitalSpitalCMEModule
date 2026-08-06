# The admin console image (P10-04).
#
# A static SPA, so the runtime stage is a web server with files in it — no
# Node, no dependency tree, nothing that needs patching monthly.
#
# ## The image knows nothing about where it will run (P16-02)
#
# It used to. Vite inlines `VITE_*` at build time, so the API base was baked in
# and the image was environment-specific: staging and production were two builds
# of one commit, moving a domain meant a full CI run for a string, and the value
# lived in a GitHub repository variable while the hostname it had to match lived
# in a GitHub secret — with nothing checking that the two agreed.
#
# Now `/config.js` is written when the container starts, from `DS_*` environment
# variables the deploy derives from `BASE_DOMAIN`. One image, any environment,
# and the configuration next to the domain it describes. See
# `infra/nginx/ds-runtime-config.sh` and `apps/admin/src/config.ts`.

FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo

# The lockfile alone primes the store: `pnpm fetch` needs nothing else, so a
# workspace package added later cannot be left out of this layer. The hand-
# maintained list of manifests that used to live here had already gone stale
# and made the API image unbuildable — see apps/api/Dockerfile for the full
# account.
COPY pnpm-lock.yaml ./
RUN pnpm fetch

COPY . .

RUN pnpm install --offline --frozen-lockfile

# No build arguments at all. Everything this app needs to know is read from
# /config.js at runtime — which is why the same image is deployable anywhere.
RUN pnpm --filter @ds/admin... build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/admin/dist /usr/share/nginx/html
COPY infra/nginx/admin.conf /etc/nginx/conf.d/default.conf

# nginx's own entrypoint runs everything in this directory before starting the
# server, so /config.js exists before the first request can ask for it. It
# exits non-zero on a missing DS_API_BASE, which stops the container — louder,
# and noticed sooner, than a page that loads and then fails every request.
COPY infra/nginx/ds-runtime-config.sh /docker-entrypoint.d/20-ds-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/20-ds-runtime-config.sh

EXPOSE 80
