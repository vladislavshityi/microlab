"""Ограничение частоты запросов: скользящее окно в памяти процесса.

Подходит для одного процесса API (как в docker-compose.yml: сессии симуляции тоже хранятся
в памяти процесса). При нескольких процессах лимиты действуют в каждом отдельно, а после
перезапуска сбрасываются.
"""

import math
import time
from collections import deque
from collections.abc import Callable
from typing import TYPE_CHECKING, Final

from microlab_api.api.errors import ApiError
from microlab_api.schemas.errors import ErrorCode

if TYPE_CHECKING:
    from microlab_api.config import Settings

# Предел числа отслеживаемых ключей: защищает память от перебора адресов.
MAX_KEYS: Final = 100_000


class SlidingWindowLimiter:
    def __init__(
        self, limit: int, window_seconds: float, clock: Callable[[], float] = time.monotonic
    ) -> None:
        self.limit = limit
        self.window = window_seconds
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}

    def _prune(self, key: str, now: float) -> deque[float]:
        hits = self._hits.get(key)
        if hits is None:
            return deque()
        while hits and hits[0] <= now - self.window:
            hits.popleft()
        if not hits:
            del self._hits[key]
        return hits

    def retry_after(self, key: str) -> float | None:
        """Секунды до освобождения места или None, если лимит не исчерпан."""
        now = self._clock()
        hits = self._prune(key, now)
        if len(hits) < self.limit:
            return None
        return max(hits[0] + self.window - now, 0.0)

    def hit(self, key: str) -> None:
        now = self._clock()
        hits = self._prune(key, now)
        if key not in self._hits:
            if len(self._hits) >= MAX_KEYS:
                # Вытесняем самый старый ключ (порядок вставки dict).
                self._hits.pop(next(iter(self._hits)))
            self._hits[key] = hits
        hits.append(now)

    def reset(self, key: str) -> None:
        self._hits.pop(key, None)

    def check_and_hit(self, key: str) -> None:
        """Засчитывает попытку или бросает 429 RATE_LIMITED."""
        raise_if_limited(self.retry_after(key))
        self.hit(key)


def raise_if_limited(*waits: float | None) -> None:
    pending = [wait for wait in waits if wait is not None]
    if pending:
        seconds = max(1, math.ceil(max(pending)))
        raise ApiError(
            429,
            ErrorCode.RATE_LIMITED,
            "Too many requests; try again later.",
            headers={"Retry-After": str(seconds)},
        )


class RateLimits:
    """Лимиты процесса API (создаются вместе с приложением)."""

    def __init__(self, settings: "Settings") -> None:
        window = settings.login_window_seconds
        # Засчитываются только неудачные попытки: класс за одним NAT входит без помех.
        self.login_ip = SlidingWindowLimiter(settings.login_attempts_per_ip, window)
        self.login_account = SlidingWindowLimiter(settings.login_attempts_per_account, window)
        self.compile = SlidingWindowLimiter(settings.compile_rate_per_minute, 60.0)
