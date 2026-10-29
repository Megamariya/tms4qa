from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from uuid import UUID
from typing import Optional

from app.db.session import get_db
from app.modules.defects.repository import DefectRepository
from app.modules.defects.service import DefectService
from app.modules.defects.schemas import DefectCreate, DefectUpdate, DefectResponse

router = APIRouter(prefix="/defects", tags=["Defects"])


def get_service(db: Session = Depends(get_db)) -> DefectService:
    return DefectService(DefectRepository(db))


def _resp(obj) -> DefectResponse:
    return DefectResponse.from_orm_with_display(obj)


@router.post("", response_model=DefectResponse, status_code=201)
def create_defect(data: DefectCreate, service: DefectService = Depends(get_service)):
    return _resp(service.create(data))


@router.get("", response_model=list[DefectResponse])
def list_defects(
    project_id: UUID,
    status: Optional[str] = None,
    test_run_id: Optional[str] = None,  # UUID прогона или "none" — дефекты без прогона
    service: DefectService = Depends(get_service),
):
    if test_run_id and test_run_id != "none":
        try:
            UUID(test_run_id)
        except ValueError:
            raise HTTPException(422, "test_run_id must be UUID or 'none'")
    return [_resp(d) for d in service.list(project_id, status, test_run_id)]


@router.get("/{defect_id}", response_model=DefectResponse)
def get_defect(defect_id: UUID, service: DefectService = Depends(get_service)):
    obj = service.get(defect_id)
    if not obj:
        raise HTTPException(404, "Defect not found")
    return _resp(obj)


@router.patch("/{defect_id}", response_model=DefectResponse)
def update_defect(defect_id: UUID, data: DefectUpdate, service: DefectService = Depends(get_service)):
    obj = service.update(defect_id, data)
    if not obj:
        raise HTTPException(404, "Defect not found")
    return _resp(obj)


@router.delete("/{defect_id}", status_code=204)
def delete_defect(defect_id: UUID, service: DefectService = Depends(get_service)):
    if not service.delete(defect_id):
        raise HTTPException(404, "Defect not found")
