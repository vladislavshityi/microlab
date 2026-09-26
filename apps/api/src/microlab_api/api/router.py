from fastapi import APIRouter, Depends

from microlab_api.api import (
    admin,
    auth,
    circuits,
    compilation,
    components,
    groups,
    health,
    projects,
    simulations,
)
from microlab_api.api.current_user import csrf_protect

API_PREFIX = "/api/v1"

api_router = APIRouter(prefix=API_PREFIX)
# Защита от CSRF для всех HTTP-маршрутов (WebSocket проверяет Origin отдельно).
http_router = APIRouter(dependencies=[Depends(csrf_protect)])
http_router.include_router(health.router)
http_router.include_router(auth.router)
http_router.include_router(groups.router)
http_router.include_router(admin.router)
http_router.include_router(components.router)
http_router.include_router(compilation.router)
http_router.include_router(circuits.router)
http_router.include_router(projects.router)
http_router.include_router(simulations.router)
api_router.include_router(http_router)
api_router.include_router(simulations.ws_router)
