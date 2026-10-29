# project_name/backend/app/main.py


import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings

from app.modules.transfer.router import router as transfer_router
from app.modules.testplans.router import router as testplans_router
from app.modules.testsuites.router import router as testsuites_router
from app.modules.testcases.router import router as testcases_router
from app.modules.testruns.router import router as testruns_router
from app.modules.defects.router import router as defects_router
from app.modules.requirements.router import router as requirements_router
from app.modules.users.router import router as users_router
from app.modules.projects.router import router as projects_router

from app.modules.organizations.router import router as organization_router
from app.modules.releases.router import router as releases_router
from app.modules.shared_steps.router import router as shared_steps_router
from app.modules.suite_orders.router import router as suite_orders_router
from app.modules.todos.router import router as todos_router
from app.modules.attachments.router import router as attachments_router
from app.modules.checklists.router import router as checklists_router

from app.modules.auth.router import router as auth_router
from app.modules.auth.audit_router import router as audit_router


from fastapi.staticfiles import StaticFiles
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.openapi.utils import get_openapi


# =========================
# Logging
# =========================
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)

logger = logging.getLogger("tms-api")


# =========================
# Lifespan (startup/shutdown)
# =========================
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 TMS API starting up")
    if not settings.JWT_SECRET:
        raise RuntimeError("JWT_SECRET is not set — define it in .env")
    try:
        from app.core.minio_client import ensure_bucket
        ensure_bucket()
    except Exception as e:
        logger.warning("MinIO init skipped: %s", e)

    # Bootstrap Super Admin + Demo Org/Owner + Demo Project
    try:
        from app.db.session import SessionLocal
        from app.modules.auth.service import bootstrap_superadmin, bootstrap_demo_project
        db = SessionLocal()
        try:
            bootstrap_superadmin(db)
            bootstrap_demo_project(db)
        finally:
            db.close()
    except Exception as e:
        logger.warning("Auth bootstrap skipped: %s", e)

    yield
    logger.info("🛑 TMS API shutting down")


# =========================
# App
# =========================
app = FastAPI(
    title="TMS4QA - Test Management System",
    version="1.0.1",
    description="API for managing test cases, runs, plans and QA workflows",
    lifespan=lifespan,
    docs_url=None,        # ❗ отключаем CDN swagger
    redoc_url=None
)


# =========================
# Swagger
# =========================
app.mount("/static", StaticFiles(directory="app/static"), name="static")


# =========================
# CORS
# =========================
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS if hasattr(settings, "ALLOWED_ORIGINS") else ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================
# Routers
# =========================
# transfer — раньше testplans/testruns (статические /import, /{id}/export)
app.include_router(transfer_router, prefix="/api/v1")
app.include_router(users_router, prefix="/api/v1")
app.include_router(organization_router, prefix="/api/v1")
app.include_router(projects_router, prefix="/api/v1")
app.include_router(testcases_router, prefix="/api/v1")
app.include_router(testsuites_router, prefix="/api/v1")
app.include_router(testplans_router, prefix="/api/v1")
app.include_router(testruns_router, prefix="/api/v1")
app.include_router(defects_router, prefix="/api/v1")
app.include_router(requirements_router, prefix="/api/v1")
app.include_router(releases_router, prefix="/api/v1")
app.include_router(shared_steps_router, prefix="/api/v1")
app.include_router(suite_orders_router, prefix="/api/v1")
app.include_router(todos_router, prefix="/api/v1")
app.include_router(attachments_router, prefix="/api/v1")
app.include_router(checklists_router, prefix="/api/v1")

app.include_router(auth_router, prefix="/api")
app.include_router(audit_router, prefix="/api/v1")



# =========================
# Healthcheck
# =========================
@app.get("/health", tags=["System"])
async def health():
    return {
        "status": "ok",
        "service": "tms-api"
    }

def _custom_openapi():
    if app.openapi_schema:
        return app.openapi_schema

    schema = get_openapi(
        title=app.title,
        version=app.version,
        description=(
            app.description +
            "\n\n**Авторизация:** выполните `POST /api/auth/login` с телом "
            "`{\"login\": \"...\", \"password\": \"...\"}`, скопируйте `access_token` "
            "и вставьте его в кнопку **Authorize** (без префикса `Bearer`)."
        ),
        routes=app.routes,
    )

    # Заменяем OAuth2PasswordBearer-схему на простой HTTP Bearer —
    # тогда Swagger показывает одно поле «Value» вместо формы OAuth2.
    schema.setdefault("components", {})["securitySchemes"] = {
        "BearerAuth": {
            "type": "http",
            "scheme": "bearer",
            "bearerFormat": "JWT",
            "description": (
                "JWT access-token. "
                "Получите через POST /api/auth/login → поле access_token."
            ),
        }
    }

    # Перезаписываем security во всех операциях на BearerAuth
    for path_item in schema.get("paths", {}).values():
        for operation in path_item.values():
            if isinstance(operation, dict) and "security" in operation:
                operation["security"] = [{"BearerAuth": []}]

    app.openapi_schema = schema
    return app.openapi_schema


app.openapi = _custom_openapi  # type: ignore[method-assign]


@app.get("/docs", include_in_schema=False)
async def custom_swagger():
    return get_swagger_ui_html(
        openapi_url=app.openapi_url,
        title="TMS API Docs",
        swagger_js_url="/static/swagger-ui-bundle.js",
        swagger_css_url="/static/swagger-ui.css",
    )