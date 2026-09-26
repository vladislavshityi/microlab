#!/bin/sh
# Одноразовая задача перед запуском API: миграции БД.
# Первый администратор создаётся отдельно: python -m microlab_api.scripts.create_admin (README).
set -eu

alembic upgrade head
