# syntax=docker/dockerfile:1.7
# Образ MicroLab API (FastAPI + uvicorn); миграции применяются при старте контейнера.
# Контекст сборки — корень репозитория: API читает определения компонентов
# из packages/circuit-schema во время работы. Набор файлов ограничен Dockerfile.dockerignore.

ARG BASE_IMAGE=python:3.13.15-slim-trixie@sha256:8d9d0b8bcf6506481eae4907c18f5e3e7902e629f5f6d684f9e7c32e85e3ddf0
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.12.13@sha256:b485bd65cc2cf1c9a93b3554012c9c3778cf7b1b5fd3d3096ce9e1226c97e1e6

FROM ${UV_IMAGE} AS uv

# --- Этап 1: виртуальное окружение с зависимостями и самим пакетом (без dev-группы) ---
FROM ${BASE_IMAGE} AS build

COPY --from=uv /uv /usr/local/bin/uv

# Интерпретатор — из базового образа (uv не скачивает CPython); байткод компилируется
# при сборке, потому что в рабочем контейнере корневая ФС только для чтения.
ENV UV_PYTHON_DOWNLOADS=never \
    UV_PYTHON=/usr/local/bin/python3.13 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/app/apps/api/.venv

WORKDIR /app/apps/api

# Сначала только зависимости: слой кэшируется, пока не меняется uv.lock.
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-install-project

COPY apps/api/src ./src
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev --no-editable

# --- Этап 2: рабочий образ ---
FROM ${BASE_IMAGE}

RUN groupadd --system --gid 10003 api \
    && useradd --system --uid 10003 --gid api --no-create-home --shell /usr/sbin/nologin api

# Раскладка повторяет монорепозиторий: приложение находит корень по apps/api/pyproject.toml
# и читает packages/circuit-schema/{schema,definitions}. Исходники в образ не копируются —
# пакет установлен в .venv не-editable.
COPY --from=build /app/apps/api/.venv /app/apps/api/.venv
COPY apps/api/pyproject.toml apps/api/alembic.ini /app/apps/api/
COPY apps/api/alembic /app/apps/api/alembic
COPY packages/circuit-schema/schema /app/packages/circuit-schema/schema
COPY packages/circuit-schema/definitions /app/packages/circuit-schema/definitions
COPY --chmod=0755 apps/api/docker/entrypoint.sh /usr/local/bin/microlab-api

# MICROLAB_FORWARDED_ALLOW_IPS — адреса обратного прокси (nginx), которому разрешено
# передавать X-Forwarded-*; docker-compose.yml задаёт подсеть сети edge.
ENV PATH=/app/apps/api/.venv/bin:${PATH} \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    MICROLAB_FORWARDED_ALLOW_IPS=127.0.0.1

USER 10003:10003
WORKDIR /app/apps/api
EXPOSE 8000

HEALTHCHECK --interval=5s --timeout=3s --start-period=60s --retries=10 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health', timeout=2)"]

# Один процесс: сессии симуляции хранятся в памяти процесса API.
CMD ["microlab-api"]
