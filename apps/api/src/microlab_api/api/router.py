from fastapi import APIRouter

from microlab_api.api import health

API_PREFIX = "/api/v1"

api_router = APIRouter(prefix=API_PREFIX)
api_router.include_router(health.router)
