"""Пользователь для разработки (dev-user): владелец всех проектов до появления аутентификации."""

import uuid
from typing import Final

DEV_USER_ID: Final = uuid.UUID("00000000-0000-0000-0000-000000000001")
DEV_USER_USERNAME: Final = "dev-user"
