# MicroLab

MicroLab — виртуальная лаборатория электроники и микроконтроллеров.

Браузерная учебная среда: студент собирает электрическую схему с Arduino UNO R3, пишет Arduino-программу, компилирует её Arduino CLI и наблюдает поведение виртуального оборудования в пределах явно заявленной точности симулятора.

> Симуляция является программной моделью электронного устройства и не заменяет измерения на реальном оборудовании.

## Статус

**Phase 0 — инфраструктура.** Реализованы монорепозиторий, backend (FastAPI + PostgreSQL + Alembic) с единственным эндпоинтом `GET /api/v1/health` и frontend-страница состояния системы. Редактора схем, компилятора и симулятора пока нет.

## Структура

```text
apps/api/                 FastAPI backend (Python 3.13, uv)
apps/web/                 React + Vite + TypeScript frontend (pnpm)
packages/circuit-schema/  будущий единый источник определений схемы и компонентов, пока пуст
simulation/               зарезервировано под Simulation Worker
docker-compose.yml        PostgreSQL 18 для разработки
.github/workflows/        CI: backend.yml, frontend.yml
```

## Требования (macOS)

| Инструмент | Версия | Установка |
|---|---|---|
| uv | 0.12.x | `brew install uv` |
| Node.js | 24 LTS (поддерживается 24–26) | `brew install fnm && fnm install 24 && fnm use 24` или любой менеджер версий, читающий `.node-version` |
| pnpm | 12.6.0 (`packageManager` в `package.json`) | `brew install pnpm` |
| Docker | Docker Desktop или OrbStack с `docker compose` | https://www.docker.com/products/docker-desktop/ / https://orbstack.dev |

Python устанавливать не нужно — uv скачает CPython 3.13 по `apps/api/.python-version`. Python-зависимости живут только в виртуальном окружении `apps/api/.venv`, которым управляет uv; не используйте `pip install` в системный Python, `sudo` и глобальные `npm -g`.

## Запуск

### 1. Конфигурация и PostgreSQL

Из корня репозитория:

```sh
cp .env.example .env              # .env не коммитится
docker compose up -d --wait       # PostgreSQL 18 на 127.0.0.1:5433
```

### 2. Backend

```sh
cd apps/api
uv sync --locked                                        # создаёт apps/api/.venv
uv run alembic upgrade head                             # миграции
uv run python -m microlab_api.scripts.seed_dev_user     # dev-пользователь (только MICROLAB_ENV=development), идемпотентно
uv run uvicorn microlab_api.main:app --host 127.0.0.1 --port 8000
```

С автоперезапуском при изменении кода:

```sh
uv run uvicorn microlab_api.main:app --app-dir src --reload --reload-dir src --host 127.0.0.1 --port 8000
```

Проверка:

```sh
curl -i http://127.0.0.1:8000/api/v1/health
# 200 {"status":"ok","version":"0.1.0","checks":{"database":{"status":"ok"}}}
# 503 {"status":"unavailable",...,"checks":{"database":{"status":"error","code":"DATABASE_UNAVAILABLE"}}} — БД недоступна
```

Swagger UI (кроме production): http://127.0.0.1:8000/api/docs.

### 3. Frontend

В другом терминале, из корня репозитория:

```sh
pnpm install --frozen-lockfile
pnpm dev                          # http://localhost:5173
```

Vite проксирует `/api` → `http://127.0.0.1:8000`; другой адрес API задаётся переменной `API_PROXY_TARGET`. Без запущенного backend страница показывает «Backend недоступен», при остановленной БД — «БД недоступна».

## Конфигурация

Переменные окружения `MICROLAB_*` (полный список с комментариями — `.env.example`):

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `MICROLAB_ENV` | — (обязательна) | `development` / `test` / `production` |
| `MICROLAB_DATABASE_URL` | — (обязательна) | DSN `postgresql+asyncpg://...` |
| `MICROLAB_LOG_LEVEL` | `INFO` | уровень логирования |
| `MICROLAB_LOG_FORMAT` | `json` | `json` или `console` |
| `MICROLAB_POSTGRES_PORT` | `5433` | порт PostgreSQL на хосте (читает `docker-compose.yml`) |

Порядок источников: переменные окружения процесса → `apps/api/.env` → `.env` в корне репозитория.

## Проверки (как в CI)

Backend — из `apps/api`, при запущенном PostgreSQL (то же выполняет `.github/workflows/backend.yml`):

```sh
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy
uv run alembic upgrade head && uv run alembic check && uv run alembic downgrade base && uv run alembic upgrade head
uv run python -m microlab_api.scripts.seed_dev_user && uv run python -m microlab_api.scripts.seed_dev_user
uv run pytest
uv run python -m microlab_api.scripts.export_openapi --check
```

`pytest` использует отдельную базу `microlab_test`: фикстура создаёт её и применяет миграции автоматически.

Frontend — из корня (то же выполняет `.github/workflows/frontend.yml` на Node 24 и 26):

```sh
pnpm install --frozen-lockfile
pnpm gen:api:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## API-контракт

`apps/api/openapi.json` — источник контракта для frontend. После изменения API:

```sh
cd apps/api && uv run python -m microlab_api.scripts.export_openapi   # обновить openapi.json
cd ../.. && pnpm gen:api && pnpm typecheck                            # обновить TS-типы
```

Ошибки API имеют формат `{"error": {"code", "message", "details": []}}` со стабильными кодами (`NOT_FOUND`, `METHOD_NOT_ALLOWED`, `VALIDATION_ERROR`, `INTERNAL_ERROR`, `DATABASE_UNAVAILABLE`, `HTTP_ERROR`). Каждый ответ содержит заголовок `X-Request-ID`, этот же id пишется в логи.

## Миграции

```sh
cd apps/api
uv run alembic upgrade head
uv run alembic downgrade -1
uv run alembic check                                                   # модели совпадают с миграциями
uv run alembic revision --autogenerate --rev-id 0002 -m "описание"
```

Каждая миграция обязана иметь рабочий `downgrade()`.

## Остановка

```sh
docker compose stop        # остановить PostgreSQL, данные сохраняются
docker compose down -v     # удалить контейнер и данные
```

## Особенности окружения

* **OrbStack.** Если `docker` не видит демон (активен другой контекст): `docker context use orbstack` или префикс `DOCKER_CONTEXT=orbstack`.
* **Скрытые `.pth` в `.venv`.** На некоторых Mac (замечено для репозитория внутри `~/Documents`, синхронизируемых с iCloud) система помечает файлы в `.venv` как hidden, и Python 3.13 игнорирует `.pth`-файлы editable-установки: `ModuleNotFoundError: No module named 'microlab_api'`. Решение — `export UV_NO_EDITABLE=1` перед командами uv (проект устанавливается в `.venv` не-editable и пересобирается при изменении `src/`), либо разместить репозиторий вне синхронизируемой папки.
* **Порт 5173 занят** — Vite завершится с ошибкой (`strictPort`); освободите порт: `lsof -iTCP:5173 -sTCP:LISTEN`.
