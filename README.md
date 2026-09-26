# MicroLab

MicroLab — виртуальная лаборатория электроники и микроконтроллеров.

Браузерная учебная среда: студент собирает электрическую схему с Arduino UNO R3, пишет Arduino-программу, компилирует её Arduino CLI и наблюдает поведение виртуального оборудования в пределах явно заявленной точности симулятора.

> Симуляция является программной моделью электронного устройства и не заменяет измерения на реальном оборудовании.

## Статус

**Circuit Model.** Реализованы монорепозиторий, backend (FastAPI + PostgreSQL + Alembic) с эндпоинтами `GET /api/v1/health` и `GET /api/v1/components[/{type}]` и frontend-оболочка IDE: панели с изменяемыми размерами, редактор кода (Monaco), пустой холст схемы, светлая/тёмная тема, индикатор состояния backend. Circuit Model: versioned-формат схемы и определения Arduino UNO R3, резистора, светодиода и кнопки в `packages/circuit-schema`, проверка ссылок и построение netlist на backend, каталог компонентов в UI (без добавления на схему). Компиляция: `POST /api/v1/compile` через изолированный воркер arduino-cli (см. «Компиляция»). Редактора схемы и симулятора пока нет.

## Структура

```text
apps/api/                 FastAPI backend (Python 3.13, uv); Dockerfile — образ API и задачи миграций
apps/web/                 React + Vite + TypeScript frontend (pnpm); Dockerfile — сборка SPA + nginx
packages/circuit-schema/  единый источник формата схемы и определений компонентов
services/compiler/        изолированный воркер компиляции (arduino-cli 1.5.1, arduino:avr 1.8.8)
services/simulator/       изолированный сервис симуляции (супервизор + microlab-sim-worker)
simulation/               эмулятор ATmega328P и модели компонентов (Rust)
deploy/nginx/             конфигурация nginx: SPA, прокси API/WebSocket, TLS, basic auth
docker-compose.yml        полный стек в контейнерах
docker-compose.dev.yml    дополнение для разработки: PostgreSQL и dev-шлюзы на 127.0.0.1
docker-compose.tls.yml    дополнение для сервера: HTTPS
docker-compose.auth.yml   дополнение: basic auth на весь сайт
.github/workflows/        CI: backend.yml, frontend.yml, simulation.yml, docker.yml
```

## Быстрый запуск (Docker)

Нужен только Docker (Docker Desktop, OrbStack или Docker Engine с плагином compose).

```sh
cp .env.example .env
docker compose up -d --build --wait
```

Приложение: http://localhost:8080. Первая сборка скачивает toolchain Arduino и собирает эмулятор (несколько минут, ≈2 GB образов); повторные сборки используют кэш.

Состав: `web` (nginx: SPA, прокси `/api/` и WebSocket `/api/v1/ws/`) → `api` (FastAPI) → `postgres`, `compiler`, `simulator`. Одноразовый `migrate` применяет миграции (и в `development` создаёт dev-пользователя) перед стартом API. Опубликован только порт nginx, по умолчанию на `127.0.0.1`; остальные контейнеры находятся во внутренних сетях без выхода в интернет.

```sh
docker compose ps                       # состояние
docker compose logs -f api web          # логи
docker compose up -d --build --wait     # после обновления кода
docker compose down                     # остановить (данные БД сохраняются в volume)
docker compose down -v                  # остановить и удалить данные
```

## Пользователи и доступ

Вход — по адресу почты и паролю (cookie сессии: HttpOnly, SameSite=Lax, Secure включает `docker-compose.tls.yml`). Роли: студент видит только свои проекты; преподаватель управляет своими группами и открывает проекты студентов групп только для просмотра (без запуска симуляции); администратор управляет пользователями и видит всё.

1. Первый администратор (пароль — из переменной окружения или с терминала, не аргументом):

   ```sh
   docker compose exec -it api python -m microlab_api.scripts.create_admin --email admin@example.edu --name "Администратор"
   # в разработке: cd apps/api && uv run python -m microlab_api.scripts.create_admin --email ...
   ```

2. Администратор в меню учётной записи → «Пользователи» создаёт преподавателей; временный пароль показывается один раз и меняется при первом входе. Там же — смена роли, сброс пароля, отключение.
3. Преподаватель → «Мои группы»: создаёт группу и код приглашения (срок действия, число регистраций), копирует ссылку `https://<хост>/join/<код>`, отзывает коды, видит студентов и их проекты.
4. Студент регистрируется по ссылке или коду на `/register`.

Ограничения (переменные `MICROLAB_*`): неудачные входы — 50 на IP и 10 на адрес за 15 минут (`LOGIN_ATTEMPTS_PER_IP`, `LOGIN_ATTEMPTS_PER_ACCOUNT`, `LOGIN_WINDOW_SECONDS`); компиляций — 10 в минуту (`COMPILE_RATE_PER_MINUTE`); проектов — 200 (`MAX_PROJECTS_PER_USER`); одновременных симуляций — 1 (`MAX_SIMULATIONS_PER_USER`, при запуске другого проекта предыдущая симуляция останавливается). Сессия истекает после 24 ч простоя и через 14 дней (`SESSION_IDLE_TIMEOUT_HOURS`, `SESSION_ABSOLUTE_TIMEOUT_HOURS`). Счётчики хранятся в памяти единственного процесса API и сбрасываются при перезапуске. Изменяющие запросы к API требуют заголовок `X-MicroLab-Request: 1` и собственный `Origin` (дополнительные — `MICROLAB_ALLOWED_ORIGINS`, JSON-список).

Учётные записи, существовавшие до появления входа (в том числе dev-user режима разработки), сохраняются вместе с проектами как студенты без пароля (`<имя>@local.invalid`): войти в них можно после сброса пароля администратором.

## Разработка

Требования (macOS):

| Инструмент | Версия | Установка |
|---|---|---|
| uv | 0.12.x | `brew install uv` |
| Node.js | 24 LTS (поддерживается 24–26) | `brew install fnm && fnm install 24 && fnm use 24` или любой менеджер версий, читающий `.node-version` |
| pnpm | 12.6.0 (`packageManager` в `package.json`) | `brew install pnpm` |
| Docker | Docker Desktop или OrbStack с `docker compose` | https://www.docker.com/products/docker-desktop/ / https://orbstack.dev |

Python устанавливать не нужно — uv скачает CPython 3.13 по `apps/api/.python-version`. Python-зависимости живут только в `apps/api/.venv`; не используйте `pip install` в системный Python, `sudo` и глобальные `npm -g`.

API и Vite работают на хосте, в Docker — PostgreSQL, воркер компиляции и сервис симуляции. Контейнеры во внутренних сетях недоступны с хоста, поэтому `docker-compose.dev.yml` публикует PostgreSQL на `127.0.0.1:5433` и добавляет dev-шлюзы `127.0.0.1:8081` → `compiler` и `127.0.0.1:8082` → `simulator` (сами сервисы остаются без выхода в интернет).

```sh
cp .env.example .env
# в .env раскомментировать: COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml
docker compose up -d --wait postgres compiler-gateway simulator-gateway
```

Без `COMPOSE_FILE` в `.env` указывайте оба файла: `docker compose -f docker-compose.yml -f docker-compose.dev.yml ...`.

Backend:

```sh
cd apps/api
uv sync --locked                                        # создаёт apps/api/.venv
uv run alembic upgrade head                             # миграции
uv run python -m microlab_api.scripts.create_admin --email admin@example.edu   # первый администратор
uv run uvicorn microlab_api.main:app --app-dir src --reload --reload-dir src --host 127.0.0.1 --port 8000
curl -i http://127.0.0.1:8000/api/v1/health             # 200 — API и БД доступны, 503 — БД недоступна
```

Swagger UI (кроме production): http://127.0.0.1:8000/api/docs.

Frontend (в другом терминале, из корня):

```sh
pnpm install --frozen-lockfile
pnpm dev                          # http://localhost:5173
```

Vite проксирует `/api` → `http://127.0.0.1:8000`; другой адрес API задаётся переменной `API_PROXY_TARGET`.

## Развёртывание на сервере

На сервере задайте `MICROLAB_ENV=production`. Доступ к данным защищён входом по паролю (раздел «Пользователи и доступ»); basic auth (`docker-compose.auth.yml`) — необязательный дополнительный барьер.

Linux-сервер с Docker Engine и плагином compose (https://docs.docker.com/engine/install/), открытые порты 80 и 443, DNS-имя (ниже `lab.example.org`).

1. Код и конфигурация:

   ```sh
   sudo git clone <repo-url> /opt/microlab && cd /opt/microlab
   sudo cp .env.example .env && sudo chmod 600 .env
   ```

   В `.env` задать `MICROLAB_POSTGRES_PASSWORD=$(openssl rand -hex 24)` (до первого запуска: пароль применяется только при создании volume), `MICROLAB_TLS_DIR=/etc/microlab/tls`, `MICROLAB_HTPASSWD_FILE=/etc/microlab/htpasswd`.

2. (Необязательно) пользователи basic auth (nginx в контейнере работает с gid 101):

   ```sh
   sudo install -d -m 0755 /etc/microlab /etc/microlab/tls
   printf 'teacher:%s\n' "$(openssl passwd -6)" | sudo tee -a /etc/microlab/htpasswd >/dev/null
   sudo chgrp 101 /etc/microlab/htpasswd && sudo chmod 0640 /etc/microlab/htpasswd
   ```

3. Сертификат Let's Encrypt (certbot на хосте, режим standalone: на время выпуска и продления nginx останавливается, затем сертификат копируется в `/etc/microlab/tls`):

   ```sh
   C="docker compose --project-directory /opt/microlab -f /opt/microlab/docker-compose.yml -f /opt/microlab/docker-compose.tls.yml -f /opt/microlab/docker-compose.auth.yml"
   sudo certbot certonly --standalone -d lab.example.org \
     --pre-hook "$C stop web" --post-hook "$C start web" \
     --deploy-hook 'install -m 0644 "$RENEWED_LINEAGE/fullchain.pem" /etc/microlab/tls/fullchain.pem && install -m 0640 -g 101 "$RENEWED_LINEAGE/privkey.pem" /etc/microlab/tls/privkey.pem'
   ```

   Хуки сохраняются в конфигурации certbot, и `certbot renew` (таймер systemd пакета certbot) выполняет их при продлении.

4. Запуск:

   ```sh
   sudo docker compose -f docker-compose.yml -f docker-compose.tls.yml -f docker-compose.auth.yml up -d --build --wait
   ```

   HTTP (80) перенаправляет на HTTPS (443), включены HTTP/2 и HSTS. Если TLS завершается внешним прокси, вместо `docker-compose.tls.yml` задайте `MICROLAB_HTTP_BIND`/`MICROLAB_HTTP_PORT` и проксируйте на этот порт (включая WebSocket `/api/v1/ws/`).

5. Обновление: `git pull`, затем та же команда `up -d --build --wait` (миграции применяются автоматически).

6. Резервная копия и восстановление БД:

   ```sh
   sudo docker compose exec -T postgres pg_dump -U microlab -d microlab -Fc > microlab-$(date +%F).dump
   sudo docker compose exec -T postgres pg_restore -U microlab -d microlab --clean --if-exists < microlab-2026-01-01.dump
   ```

## Конфигурация

Переменные окружения `MICROLAB_*` (полный список с комментариями — `.env.example`). Порядок источников для API на хосте: окружение процесса → `apps/api/.env` → `.env` в корне. В контейнерах значения задаёт `docker-compose.yml`.

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `MICROLAB_ENV` | — (обязательна) | `development` / `test` / `production` |
| `MICROLAB_POSTGRES_PASSWORD` | — (обязательна для compose) | пароль БД; на сервере — случайный |
| `MICROLAB_HTTP_BIND` / `MICROLAB_HTTP_PORT` | `127.0.0.1` / `8080` | адрес и порт nginx полного стека |
| `MICROLAB_EDGE_SUBNET` | `10.253.83.0/29` | подсеть nginx ↔ API (доверие к `X-Forwarded-*`) |
| `MICROLAB_TLS_DIR` / `MICROLAB_HTPASSWD_FILE` | — | сертификаты и htpasswd для `docker-compose.tls.yml` / `docker-compose.auth.yml` |
| `MICROLAB_DATABASE_URL` | — (обязательна для API на хосте) | DSN `postgresql+asyncpg://...` |
| `MICROLAB_LOG_LEVEL` | `INFO` | уровень логирования |
| `MICROLAB_LOG_FORMAT` | `json` | `json` или `console` (API на хосте) |
| `MICROLAB_COMPILER_URL` | — | адрес воркера компиляции; не задан — `POST /compile` отвечает 503 |
| `MICROLAB_COMPILER_TIMEOUT_SECONDS` | `90` | общий таймаут запроса к воркеру |
| `MICROLAB_SIMULATOR_URL` | — | адрес сервиса симуляции (WebSocket) |
| `MICROLAB_POSTGRES_PORT` / `MICROLAB_COMPILER_PORT` / `MICROLAB_SIMULATOR_PORT` | `5433` / `8081` / `8082` | порты `docker-compose.dev.yml` на 127.0.0.1 |

## Проверки (как в CI)

Backend — из `apps/api`, при запущенном PostgreSQL (то же выполняет `.github/workflows/backend.yml`):

```sh
uv sync --locked
uv run ruff check .
uv run ruff format --check .
uv run mypy
uv run alembic upgrade head && uv run alembic check && uv run alembic downgrade base && uv run alembic upgrade head
uv run pytest
uv run python -m microlab_api.scripts.export_openapi --check
uv run python -m microlab_api.scripts.gen_circuit_schema --check
```

`pytest` использует отдельную базу `microlab_test`: фикстура создаёт её и применяет миграции автоматически. Интеграционные тесты компилятора (`-m compiler`) выполняются, только если воркер доступен по `MICROLAB_COMPILER_URL`, иначе пропускаются.

Frontend — из корня (то же выполняет `.github/workflows/frontend.yml` на Node 24 и 26):

```sh
pnpm install --frozen-lockfile
pnpm gen:api:check
pnpm gen:circuit-schema:check
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

Ошибки API имеют формат `{"error": {"code", "message", "details": []}}` со стабильными кодами (`NOT_FOUND`, `METHOD_NOT_ALLOWED`, `VALIDATION_ERROR`, `INTERNAL_ERROR`, `DATABASE_UNAVAILABLE`, `HTTP_ERROR`, `UNKNOWN_COMPONENT_TYPE`, `SOURCE_TOO_LARGE`, `COMPILER_UNAVAILABLE`, `COMPILER_BUSY`, `COMPILATION_TIMEOUT`, `COMPILER_OUTPUT_TOO_LARGE`).

## Компиляция

`POST /api/v1/compile` с телом `{"code": "..."}` компилирует скетч для `arduino:avr:uno`. Ошибки в коде — результат, а не сбой запроса: ответ 200 со `status: "error"` и `diagnostics[]` (`file`, `line`, `column`, `severity`, `message`; строки — строки `sketch.ino`). При успехе `firmware` содержит Intel HEX и его SHA-256, `sizes` — занятые flash/RAM.

Воркер `services/compiler` запускается только в контейнере: версии arduino-cli, базового образа и платформы зафиксированы, контрольные суммы проверяются при сборке образа; профиль `sketch.yaml` фиксирует FQBN и `arduino:avr (1.8.8)` без сторонних библиотек (доступны только библиотеки платформы). Изоляция: пользователь без root, read-only root FS, `cap_drop: ALL`, `no-new-privileges`, лимиты памяти/CPU/процессов, tmpfs с `noexec`, внутренняя сеть без выхода в интернет. Каждая компиляция — новая временная директория, таймаут 60 с (все процессы сборки завершаются), `prlimit` на CPU/память/размер файлов/число процессов, исходник до 256 KiB, вывод до 64 KB, не более 2 компиляций одновременно (очередь ждёт 10 с, затем `COMPILER_BUSY`).

Воркер доступен только во внутренней сети: в полном стеке API обращается к нему напрямую, при разработке — через dev-шлюз `compiler-gateway` (`127.0.0.1:8081`). Каждый ответ содержит заголовок `X-Request-ID`, этот же id пишется в логи.

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
docker compose stop        # остановить контейнеры, данные сохраняются
docker compose down -v     # удалить контейнеры и данные
```

## Особенности окружения

* **OrbStack.** Если `docker` не видит демон (активен другой контекст): `docker context use orbstack` или префикс `DOCKER_CONTEXT=orbstack`.
* **Скрытые `.pth` в `.venv`.** На некоторых Mac (замечено для репозитория внутри `~/Documents`, синхронизируемых с iCloud) система помечает файлы в `.venv` как hidden, и Python 3.13 игнорирует `.pth`-файлы editable-установки: `ModuleNotFoundError: No module named 'microlab_api'`. Решение — `export UV_NO_EDITABLE=1` перед командами uv (проект устанавливается в `.venv` не-editable и пересобирается при изменении `src/`), либо разместить репозиторий вне синхронизируемой папки.
* **Порт 5173 занят** — Vite завершится с ошибкой (`strictPort`); освободите порт: `lsof -iTCP:5173 -sTCP:LISTEN`.
