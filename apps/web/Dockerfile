# syntax=docker/dockerfile:1.7
# Frontend MicroLab: сборка SPA (Vite) и раздача через nginx без root.
# Контекст сборки — корень репозитория (pnpm workspace). Набор файлов ограничен
# Dockerfile.dockerignore.

ARG NODE_IMAGE=node:24.21.0-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe
ARG NGINX_IMAGE=nginxinc/nginx-unprivileged:1.30.5-alpine@sha256:4714e0b1b2577eaa1a6131d07c958b67f0eb68e6d0521e90c6e5287db8cf0bc5

# --- Этап 1: сборка ---
FROM ${NODE_IMAGE} AS build

# pnpm той версии, что указана в поле packageManager (corepack проверяет подпись пакета).
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_HOME=/pnpm \
    CI=true
RUN corepack enable

WORKDIR /repo

# Сначала манифесты: слой с зависимостями кэшируется, пока не меняется lockfile.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY packages/circuit-schema/package.json packages/circuit-schema/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store \
    && pnpm install --frozen-lockfile

COPY packages/circuit-schema packages/circuit-schema
COPY apps/web apps/web
COPY deploy/nginx/gen-csp.mjs /build/gen-csp.mjs
RUN pnpm --filter @microlab/web build \
    && node /build/gen-csp.mjs apps/web/dist/index.html /build/csp.conf

# --- Этап 2: nginx ---
FROM ${NGINX_IMAGE}

COPY deploy/nginx/nginx.conf /etc/nginx/nginx.conf
COPY deploy/nginx/http.conf /etc/nginx/conf.d/default.conf
COPY deploy/nginx/app.conf deploy/nginx/proxy.conf deploy/nginx/security-headers.conf \
     deploy/nginx/security-headers-api.conf /etc/nginx/snippets/
COPY --from=build /build/csp.conf /etc/nginx/snippets/csp.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=10 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/nginx-health"]

# Без скриптов docker-entrypoint.d: они изменяют конфиги, а корневая ФС только для чтения.
ENTRYPOINT ["nginx", "-g", "daemon off;"]
