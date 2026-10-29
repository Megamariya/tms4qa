from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from uuid import UUID
from typing import List

from app.db.session import get_db

from app.modules.testsuites.repository import TestSuiteRepository
from app.modules.testsuites.service import TestSuiteService
from app.modules.testsuites.schemas import (
    TestSuiteCreate,
    TestSuiteResponse,
    TestSuiteUpdate
)

router = APIRouter(prefix="/testsuites", tags=["TestSuites"])


def get_service(db: Session = Depends(get_db)):
    return TestSuiteService(TestSuiteRepository(db))


@router.post("", response_model=TestSuiteResponse)
def create(data: TestSuiteCreate, service: TestSuiteService = Depends(get_service)):
    return service.create(data)


@router.get("", response_model=List[TestSuiteResponse])
def list(project_id: UUID, service: TestSuiteService = Depends(get_service)):
    return service.list(project_id)


@router.get("/{suite_id}", response_model=TestSuiteResponse)
def get(suite_id: UUID, service: TestSuiteService = Depends(get_service)):
    obj = service.get(suite_id)
    if not obj:
        raise HTTPException(404, "TestSuite not found")
    return obj


@router.patch("/{suite_id}", response_model=TestSuiteResponse)
def update(suite_id: UUID, data: TestSuiteUpdate, service: TestSuiteService = Depends(get_service)):
    obj = service.update(suite_id, data)
    if not obj:
        raise HTTPException(404, "TestSuite not found")
    return obj


@router.delete("/{suite_id}")
def delete(suite_id: UUID, keep_cases: bool = False, service: TestSuiteService = Depends(get_service)):
    ok = service.delete_subtree(suite_id, keep_cases=keep_cases)
    if not ok:
        raise HTTPException(404, "TestSuite not found")
    return {"status": "deleted"}