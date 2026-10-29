from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from uuid import UUID

from app.db.session import get_db
from app.modules.checklists.repository import ChecklistRepository
from app.modules.checklists.service import ChecklistService
from app.modules.checklists.schemas import (
    ChecklistCreate,
    ChecklistUpdate,
    ChecklistResponse,
    RunChecklistAttach,
    RunChecklistItemsUpdate,
    RunChecklistResponse,
)

router = APIRouter(tags=["Checklists"])


def get_service(db: Session = Depends(get_db)) -> ChecklistService:
    return ChecklistService(ChecklistRepository(db))


# ── Checklists CRUD ──

@router.post("/checklists", response_model=ChecklistResponse, status_code=201)
def create_checklist(data: ChecklistCreate, service: ChecklistService = Depends(get_service)):
    return service.create(data)


@router.get("/checklists", response_model=list[ChecklistResponse])
def list_checklists(project_id: UUID, service: ChecklistService = Depends(get_service)):
    return service.list(project_id)


@router.get("/checklists/{checklist_id}", response_model=ChecklistResponse)
def get_checklist(checklist_id: UUID, service: ChecklistService = Depends(get_service)):
    obj = service.get(checklist_id)
    if not obj:
        raise HTTPException(404, "Checklist not found")
    return obj


@router.patch("/checklists/{checklist_id}", response_model=ChecklistResponse)
def update_checklist(checklist_id: UUID, data: ChecklistUpdate, service: ChecklistService = Depends(get_service)):
    obj = service.update(checklist_id, data)
    if not obj:
        raise HTTPException(404, "Checklist not found")
    return obj


@router.delete("/checklists/{checklist_id}", status_code=204)
def delete_checklist(checklist_id: UUID, service: ChecklistService = Depends(get_service)):
    if not service.delete(checklist_id):
        raise HTTPException(404, "Checklist not found")


# ── Привязка чек-листов к тестовому прогону ──

@router.get("/testruns/{run_id}/checklists", response_model=list[RunChecklistResponse])
def list_run_checklists(run_id: UUID, service: ChecklistService = Depends(get_service)):
    return service.list_for_run(run_id)


@router.post("/testruns/{run_id}/checklists", response_model=RunChecklistResponse, status_code=201)
def attach_run_checklist(run_id: UUID, data: RunChecklistAttach, service: ChecklistService = Depends(get_service)):
    if not service.get(data.checklist_id):
        raise HTTPException(404, "Checklist not found")
    service.attach_to_run(run_id, data.checklist_id)
    return next(c for c in service.list_for_run(run_id) if c["checklist_id"] == data.checklist_id)


@router.patch("/testruns/{run_id}/checklists/{checklist_id}", response_model=RunChecklistResponse)
def update_run_checklist_items(
    run_id: UUID,
    checklist_id: UUID,
    data: RunChecklistItemsUpdate,
    service: ChecklistService = Depends(get_service),
):
    obj = service.update_checked_items(run_id, checklist_id, data.checked_items)
    if not obj:
        raise HTTPException(404, "Checklist is not attached to this run")
    return next(c for c in service.list_for_run(run_id) if c["checklist_id"] == checklist_id)


@router.delete("/testruns/{run_id}/checklists/{checklist_id}", status_code=204)
def detach_run_checklist(run_id: UUID, checklist_id: UUID, service: ChecklistService = Depends(get_service)):
    if not service.detach_from_run(run_id, checklist_id):
        raise HTTPException(404, "Checklist is not attached to this run")
