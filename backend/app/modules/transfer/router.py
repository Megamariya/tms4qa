from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, Body, Depends
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.core.dependencies import get_current_user
from app.db.session import get_db
from app.modules.transfer import service

# Пути под /testplans и /testruns — подключается в main.py РАНЬШЕ их роутеров
router = APIRouter(tags=["Transfer (export / import)"])


def _download(payload: dict, prefix: str, name: str) -> JSONResponse:
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "_" for ch in name)[:60] or prefix
    ascii_name = safe.encode("ascii", "ignore").decode() or prefix
    # filename* (RFC 5987) — для кириллицы; filename — ASCII-фолбэк
    return JSONResponse(
        payload,
        headers={"Content-Disposition": (
            f'attachment; filename="4qa_{prefix}_{ascii_name}.json"; '
            f"filename*=UTF-8''{quote(f'4qa_{prefix}_{safe}.json')}"
        )},
    )


@router.get("/testplans/{plan_id}/export")
def export_plan(plan_id: UUID, db: Session = Depends(get_db), user=Depends(get_current_user)):
    payload = service.export_plan(db, plan_id)
    return _download(payload, "plan", payload["plan"]["name"])


@router.post("/testplans/import", status_code=201)
def import_plan(
    project_id: UUID,
    reuse_existing: bool = True,
    data: dict = Body(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    return service.import_plan(db, project_id, data, reuse_existing=reuse_existing)


@router.get("/testruns/{run_id}/export")
def export_run(
    run_id: UUID,
    include_attachments: bool = True,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    payload = service.export_run(db, run_id, include_attachments=include_attachments)
    return _download(payload, "run", payload["run"]["name"])


@router.post("/testruns/import", status_code=201)
def import_run(
    project_id: UUID,
    reuse_existing: bool = True,
    include_plan: bool = True,
    data: dict = Body(...),
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    return service.import_run(
        db, project_id, data, started_by=user["id"],
        reuse_existing=reuse_existing, include_plan=include_plan,
    )
