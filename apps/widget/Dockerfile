# The widget bundle, served as a static asset (P10-04).
#
# The WordPress plugin can ship `assets/ds-lms.js` itself, and for MEDICE it
# does. This image exists for the other case: a customer whose site should load
# the widget from a URL we control, so a fix reaches them without them
# redeploying a plugin.
#
# Consequently the one thing that matters here is CORS — the script is fetched
# cross-origin by definition.

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
RUN pnpm --filter @ds/widget... build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/widget/dist /usr/share/nginx/html
COPY infra/nginx/widget.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
