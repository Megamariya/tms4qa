from __future__ import annotations
from typing import List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.dependencies import get_current_user
from app.modules.shared_steps.schemas import (
    SharedStepFolderCreate, SharedStepFolderUpdate, SharedStepFolderOut,
    SharedStepCreate, SharedStepUpdate, SharedStepOut,
)
from app.modules.shared_steps.repository import SharedStepFolderRepository, SharedStepRepository

router = APIRouter(tags=["Shared Steps"])


# ── Folders ───────────────────────────────────────────────────────────────────

@router.get("/shared-step-folders", response_model=List[SharedStepFolderOut])
def list_folders(project_id: UUID, db: Session = Depends(get_db), _=Depends(get_current_user)):
    return SharedStepFolderRepository(db).list(project_id)


@router.post("/shared-step-folders", response_model=SharedStepFolderOut, status_code=status.HTTP_201_CREATED)
def create_folder(data: SharedStepFolderCreate, db: Session = Depends(get_db), _=Depends(get_current_user)):
    return SharedStepFolderRepository(db).create(data.project_id, data.name)


@router.patch("/shared-step-folders/{folder_id}", response_model=SharedStepFolderOut)
def update_folder(folder_id: UUID, data: SharedStepFolderUpdate, db: Session = Depends(get_db), _=Depends(get_current_user)):
    folder = SharedStepFolderRepository(db).update(folder_id, data.name or "")
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    return folder


@router.delete("/shared-step-folders/{folder_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_folder(folder_id: UUID, db: Session = Depends(get_db), _=Depends(get_current_user)):
    ok = SharedStepFolderRepository(db).delete(folder_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Folder not found")


# ── Steps ─────────────────────────────────────────────────────────────────────

@router.get("/shared-steps", response_model=List[SharedStepOut])
def list_steps(project_id: UUID, db: Session = Depends(get_db), _=Depends(get_current_user)):
    return SharedStepRepository(db).list(project_id)


@router.get("/shared-steps/{step_id}", response_model=SharedStepOut)
def get_step(step_id: UUID, db: Session = Depends(get_db), _=Depends(get_current_user)):
    step = SharedStepRepository(db).get(step_id)
    if not step:
        raise HTTPException(status_code=404, detail="Shared step not found")
    return step


@router.post("/shared-steps", response_model=SharedStepOut, status_code=status.HTTP_201_CREATED)
def create_step(data: SharedStepCreate, db: Session = Depends(get_db), _=Depends(get_current_user)):
    return SharedStepRepository(db).create(data.model_dump())


@router.patch("/shared-steps/{step_id}", response_model=SharedStepOut)
def update_step(step_id: UUID, data: SharedStepUpdate, db: Session = Depends(get_db), _=Depends(get_current_user)):
    step = SharedStepRepository(db).update(step_id, data.model_dump(exclude_none=True))
    if not step:
        raise HTTPException(status_code=404, detail="Shared step not found")
    return step


@router.delete("/shared-steps/{step_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_step(step_id: UUID, db: Session = Depends(get_db), _=Depends(get_current_user)):
    ok = SharedStepRepository(db).delete(step_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Shared step not found")
