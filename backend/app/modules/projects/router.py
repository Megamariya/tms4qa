from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from uuid import UUID

from app.core.dependencies import get_db, get_current_user
from app.modules.projects.schemas import ProjectCreate, ProjectUpdate, ProjectOut
from app.modules.projects.service import ProjectService

router = APIRouter(prefix="/projects", tags=["Projects"])

service = ProjectService()


def _require_org(user: dict) -> str:
    """Return organization_id or raise 403 for SUPER_ADMIN without an org."""
    org_id = user.get("organization_id")
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "SUPER_ADMIN не привязан к организации. "
                "Для работы с проектами войдите как OWNER (owner@demo.local / Demo123!)."
            ),
        )
    return org_id


@router.get("/", response_model=list[ProjectOut])
def list_projects(
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    org_id = _require_org(user)
    return service.list_projects(db, org_id)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(
    project_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    org_id = _require_org(user)
    project = service.get_project(db, project_id, org_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.post("/", response_model=ProjectOut, status_code=status.HTTP_201_CREATED)
def create_project(
    data: ProjectCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    org_id = _require_org(user)
    return service.create_project(db, data, org_id)


@router.patch("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: UUID,
    data: ProjectUpdate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    org_id = _require_org(user)
    project = service.get_project(db, project_id, org_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return service.update_project(db, project, data)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user),
):
    org_id = _require_org(user)
    project = service.get_project(db, project_id, org_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    service.delete_project(db, project)
