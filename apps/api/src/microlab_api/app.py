"""Фабрика приложения. Импорт этого модуля не имеет побочных эффектов."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from importlib.metadata import version

from fastapi import FastAPI

from microlab_api.api.errors import register_exception_handlers
from microlab_api.api.middleware import RequestIdMiddleware
from microlab_api.api.openapi import install_openapi
from microlab_api.api.router import api_router
from microlab_api.config import Settings, get_settings
from microlab_api.db.database import Database
from microlab_api.logging import configure_logging


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    configure_logging(settings.log_level, settings.log_format)
    database = Database(settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        yield
        await database.dispose()

    app = FastAPI(
        title="MicroLab API",
        version=version("microlab-api"),
        lifespan=lifespan,
        docs_url="/api/docs" if settings.env != "production" else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if settings.env != "production" else None,
    )
    app.state.settings = settings
    app.state.database = database

    app.add_middleware(RequestIdMiddleware)
    register_exception_handlers(app)
    app.include_router(api_router)
    install_openapi(app)
    return app
