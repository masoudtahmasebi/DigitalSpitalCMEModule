# The admin console image (P10-04).
#
# A static SPA, so the runtime stage is a web server with files in it — no
# Node, no dependency tree, nothing that needs patching monthly.
#
# ## Build-time configuration, and what that means for deployment
#
# Vite inlines `VITE_*` at build time, so the API base, the Keycloak issuer and
# the client id are baked into the bundle. That is fine — none is secret (see
# `src/config.ts`) — but it does mean **the image is environment-specific**.
# Staging and production are two builds, not one image with two configs. The
# deploy script passes them as build arguments so that is explicit rather than
# discovered.

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

ARG VITE_API_BASE
ARG VITE_PROJECT_SLUG
ARG VITE_KEYCLOAK_ISSUER
ARG VITE_KEYCLOAK_CLIENT_ID
ARG VITE_REDIRECT_URI
ENV VITE_API_BASE=$VITE_API_BASE \
    VITE_PROJECT_SLUG=$VITE_PROJECT_SLUG \
    VITE_KEYCLOAK_ISSUER=$VITE_KEYCLOAK_ISSUER \
    VITE_KEYCLOAK_CLIENT_ID=$VITE_KEYCLOAK_CLIENT_ID \
    VITE_REDIRECT_URI=$VITE_REDIRECT_URI

RUN pnpm --filter @ds/admin... build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/admin/dist /usr/share/nginx/html
COPY infra/nginx/admin.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
