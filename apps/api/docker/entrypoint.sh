#!/bin/sh
# Запуск API: миграции БД (под advisory lock), затем uvicorn.
# MICROLAB_MIGRATE_ON_START=0 отключает миграции (например, при нескольких репликах
# с отдельным шагом миграций).
# Первый администратор создаётся отдельно: python -m microlab_api.scripts.create_admin (README).
set -eu

if [ "${MICROLAB_MIGRATE_ON_START:-1}" = "1" ]; then
  alembic upgrade head
fi

# exec заменяет shell, сигналы получает uvicorn.
exec uvicorn microlab_api.main:app --host 0.0.0.0 --port 8000 --proxy-headers \
  --forwarded-allow-ips "$MICROLAB_FORWARDED_ALLOW_IPS" --no-server-header \
  --timeout-graceful-shutdown 10
