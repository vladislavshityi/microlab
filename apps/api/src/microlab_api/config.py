"""Настройки приложения из переменных окружения ``MICROLAB_*``.

Источники (по убыванию приоритета): явные аргументы конструктора, окружение процесса,
``apps/api/.env``, ``.env`` в корне репозитория.

Корень репозитория ищется подъёмом вверх от этого файла и от текущей рабочей директории
до первой директории, содержащей ``apps/api/pyproject.toml``. Это работает как для
editable-, так и для non-editable-установки и для команд, запущенных из корня или из
``apps/api``.
"""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AnyHttpUrl, AnyWebsocketUrl, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

_API_PROJECT_MARKER = Path("apps") / "api" / "pyproject.toml"


def find_repo_root() -> Path | None:
    """Возвращает корень репозитория MicroLab или None при запуске вне checkout."""
    for start in (Path(__file__).resolve().parent, Path.cwd().resolve()):
        for directory in (start, *start.parents):
            if (directory / _API_PROJECT_MARKER).is_file():
                return directory
    return None


def _env_files() -> tuple[Path, ...]:
    root = find_repo_root()
    if root is None:
        return ()
    # Более поздние файлы переопределяют более ранние.
    return (root / ".env", root / "apps" / "api" / ".env")


ENV_FILES: tuple[Path, ...] = _env_files()

type Environment = Literal["development", "test", "production"]
type LogLevel = Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"]
type LogFormat = Literal["json", "console"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="MICROLAB_",
        env_file=ENV_FILES,
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    # Обязательно, без значения по умолчанию: незаданное окружение никогда не должно
    # молча превращаться в "development".
    env: Environment
    # SecretStr: DSN содержит пароль и никогда не должен попадать в repr или логи.
    database_url: SecretStr
    log_level: LogLevel = "INFO"
    log_format: LogFormat = "json"
    # Адрес воркера компиляции (services/compiler). Не задан — компиляция недоступна (503).
    compiler_url: AnyHttpUrl | None = None
    # Общий таймаут запроса к воркеру; больше таймаута компиляции в воркере (60 с)
    # и ожидания в его очереди (10 с).
    compiler_timeout_seconds: float = Field(default=90.0, gt=0)
    # Адрес сервиса симуляции (services/simulator, WebSocket). Не задан — симуляция
    # недоступна (503 SIMULATOR_UNAVAILABLE).
    simulator_url: AnyWebsocketUrl | None = None
    simulator_connect_timeout_seconds: float = Field(default=5.0, gt=0)
    # Ожидание ответа на команду; больше таймаута вызова worker в сервисе симуляции (10 с).
    simulator_command_timeout_seconds: float = Field(default=20.0, gt=0)
    # Сессия без подписчиков WebSocket останавливается через это время.
    simulation_idle_timeout_seconds: float = Field(default=300.0, gt=0)

    # --- Аутентификация ---
    # Флаг Secure у cookie сессии. None — включён везде, кроме development/test; для
    # production по обычному HTTP (без TLS) задайте false явно.
    session_cookie_secure: bool | None = None
    # Сессия завершается после простоя и в любом случае по истечении абсолютного срока.
    session_idle_timeout_hours: float = Field(default=24.0, gt=0)
    session_absolute_timeout_hours: float = Field(default=14 * 24.0, gt=0)
    # Разрешённые Origin для изменяющих запросов и WebSocket помимо собственного хоста
    # (например, ["https://lab.example.edu"]; в окружении — JSON-список).
    allowed_origins: list[str] = Field(default_factory=list)
    # Ограничение неудачных попыток входа (скользящее окно в памяти процесса API).
    login_attempts_per_ip: int = Field(default=50, ge=1)
    login_attempts_per_account: int = Field(default=10, ge=1)
    login_window_seconds: float = Field(default=900.0, gt=0)
    # Квоты пользователя.
    max_simulations_per_user: int = Field(default=1, ge=1)
    compile_rate_per_minute: int = Field(default=10, ge=1)
    max_projects_per_user: int = Field(default=200, ge=1)

    @property
    def cookie_secure(self) -> bool:
        if self.session_cookie_secure is not None:
            return self.session_cookie_secure
        return self.env == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
