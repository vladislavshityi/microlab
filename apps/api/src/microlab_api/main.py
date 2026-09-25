"""Точка входа ASGI: ``uvicorn microlab_api.main:app``.

Импорт этого модуля создаёт приложение (читает настройки, настраивает логирование). Коду,
которому нужна только фабрика (тесты, скрипты), следует импортировать
:func:`microlab_api.app.create_app`.
"""

from microlab_api.app import create_app

app = create_app()
