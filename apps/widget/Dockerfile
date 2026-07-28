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
RUN pnpm --filter @ds/widget... build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/widget/dist /usr/share/nginx/html
COPY infra/nginx/widget.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
