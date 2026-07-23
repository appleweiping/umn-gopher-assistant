FROM node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57 AS build

ENV COREPACK_HOME=/opt/corepack
WORKDIR /workspace

RUN corepack enable \
    && corepack prepare pnpm@10.34.5 --activate

COPY .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/edge-gateway/package.json apps/edge-gateway/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts --filter @umn-gopher-assistant/edge-gateway...

COPY apps/edge-gateway apps/edge-gateway
RUN pnpm --filter @umn-gopher-assistant/edge-gateway build

FROM node:24.11.1-bookworm-slim@sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57

ARG GPGV_VERSION=2.2.40-1.1+deb12u2
ARG LIBCAP2_VERSION=1:2.66-4+deb12u3+b1
ARG LIBGNUTLS30_VERSION=3.7.9-2+deb12u7
ARG LIBPAM_VERSION=1.5.2-6+deb12u2

ENV HOME=/nonexistent \
    NODE_ENV=production \
    NODE_OPTIONS=--enable-source-maps
WORKDIR /app

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install --yes --no-install-recommends \
      "gpgv=${GPGV_VERSION}" \
      "libcap2=${LIBCAP2_VERSION}" \
      "libgnutls30=${LIBGNUTLS30_VERSION}" \
      "libpam-modules=${LIBPAM_VERSION}" \
      "libpam-modules-bin=${LIBPAM_VERSION}" \
      "libpam-runtime=${LIBPAM_VERSION}" \
      "libpam0g=${LIBPAM_VERSION}" \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid 10001 --home-dir /nonexistent --no-create-home app \
    && rm -rf /opt/yarn-v1.22.22 /usr/local/lib/node_modules \
    && rm -f /usr/local/bin/corepack /usr/local/bin/npm /usr/local/bin/npx \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && command -v node \
    && ! command -v npm \
    && ! command -v corepack \
    && ! command -v yarn

COPY --from=build --chown=10001:10001 /workspace/apps/edge-gateway/dist ./dist

USER 10001:10001
EXPOSE 8080

CMD ["node", "dist/main.js"]
