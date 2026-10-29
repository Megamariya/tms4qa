from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from uuid import UUID

from app.db.session import get_db
from app.modules.releases.repository import ReleaseRepository
from app.modules.releases.service import ReleaseService
from app.modules.releases.schemas import ReleaseCreate, ReleaseUpdate, ReleaseResponse

router = APIRouter(prefix="/releases", tags=["Releases"])


def get_service(db: Session = Depends(get_db)) -> ReleaseService:
    return ReleaseService(ReleaseRepository(db))


@router.post("", response_model=ReleaseResponse, status_code=201)
def create_release(data: ReleaseCreate, service: ReleaseService = Depends(get_service)):
    return service.create(data)


@router.get("", response_model=list[ReleaseResponse])
def list_releases(project_id: UUID, service: ReleaseService = Depends(get_service)):
    return service.list(project_id)


@router.get("/{release_id}", response_model=ReleaseResponse)
def get_release(release_id: UUID, service: ReleaseService = Depends(get_service)):
    obj = service.get(release_id)
    if not obj:
        raise HTTPException(404, "Release not found")
    return obj


@router.patch("/{release_id}", response_model=ReleaseResponse)
def update_release(release_id: UUID, data: ReleaseUpdate, service: ReleaseService = Depends(get_service)):
    obj = service.update(release_id, data)
    if not obj:
        raise HTTPException(404, "Release not found")
    return obj


@router.delete("/{release_id}", status_code=204)
def delete_release(release_id: UUID, service: ReleaseService = Depends(get_service)):
    if not service.delete(release_id):
        raise HTTPException(404, "Release not found")
