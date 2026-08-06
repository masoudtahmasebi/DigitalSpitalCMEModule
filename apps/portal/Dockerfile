# The standalone portal image (P11-01).
#
# A static SPA, so the runtime stage is a web server with files in it — no
# Node, no dependency tree, nothing that needs patching monthly.
#
# The build also produces `ds-lms.js`: `pnpm --filter @ds/portal... build`
# builds `@ds/widget` first (the portal declares it as a dependency for exactly
# that ordering), and the portal's own build step copies the resulting bundle
# into `public/`. One widget artifact, built once, shared with the WordPress
# plugin — see scripts/bundle-widget.mjs for why it must not be re-bundled.
#
# ## The image knows nothing about where it will run (P16-02)
#
# It used to: Vite inlines `VITE_*` at build time, so the API base, the Keycloak
# issuer and the client id were baked in and the image was environment-specific.
# Now `/config.js` is written when the container starts, from `DS_*` environment
# variables the deploy derives from `BASE_DOMAIN` — one image, any environment.
# See `infra/nginx/ds-runtime-config.sh` and `apps/admin/Dockerfile` for the
# full account of what that fixed.

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

# No build arguments at all — see the note above.
RUN pnpm --filter @ds/portal... build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/portal/dist /usr/share/nginx/html
COPY infra/nginx/portal.conf /etc/nginx/conf.d/default.conf

# Runs before nginx starts, so /config.js exists before the first request.
COPY infra/nginx/ds-runtime-config.sh /docker-entrypoint.d/20-ds-runtime-config.sh
RUN chmod +x /docker-entrypoint.d/20-ds-runtime-config.sh

EXPOSE 80
