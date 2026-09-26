#!/bin/sh
# Одноразовая задача перед запуском API: миграции БД и (только в development) dev-пользователь.
set -eu

alembic upgrade head

# До появления аутентификации все проекты принадлежат dev-пользователю; скрипт сам
# отказывается работать вне development, поэтому вызывается только в этом режиме.
if [ "${MICROLAB_ENV:-}" = "development" ]; then
    python -m microlab_api.scripts.seed_dev_user
fi
