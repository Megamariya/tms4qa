from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from uuid import UUID
from typing import List

from app.db.session import get_db

from app.modules.testcases.schemas import (
    TestCaseCreate,
    TestCaseResponse,
    TestCaseUpdate,
    BulkMoveSuiteRequest,
    BatchReorderRequest,
)
from app.modules.testcases.repository import TestCaseRepository
from app.modules.testcases.service import TestCaseService

router = APIRouter(prefix="/testcases", tags=["Test Cases"])


def get_service(db: Session = Depends(get_db)):
    return TestCaseService(TestCaseRepository(db))


@router.post(
    "",
    response_model=TestCaseResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create test case",
    description="Creates a new test case inside a project"
)
def create_testcase(
    data: TestCaseCreate,
    service: TestCaseService = Depends(get_service)
):
    return service.create(data)


@router.get(
    "",
    response_model=List[TestCaseResponse],
    summary="List test cases",
    description="Returns list of test cases. Can be filtered by project"
)
def list_testcases(
    project_id: UUID | None = Query(
        default=None,
        description="Filter test cases by project ID",
        example="a3bb189e-8bf9-3888-9912-ace4e6543002"
    ),
    service: TestCaseService = Depends(get_service)
):
    return service.list(project_id)


@router.get(
    "/{test_case_id}",
    response_model=TestCaseResponse,
    summary="Get test case",
    description="Returns a single test case by ID"
)
def get_testcase(
    test_case_id: UUID,
    service: TestCaseService = Depends(get_service)
):
    obj = service.get(test_case_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Test case not found")
    return obj


@router.patch(
    "/{test_case_id}",
    response_model=TestCaseResponse,
    summary="Update test case",
    description="Updates test case fields"
)
def update_testcase(
    test_case_id: UUID,
    data: TestCaseUpdate,
    service: TestCaseService = Depends(get_service)
):
    obj = service.update(test_case_id, data)
    if not obj:
        raise HTTPException(status_code=404, detail="Test case not found")
    return obj


@router.delete(
    "/{test_case_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete test case",
    description="Deletes test case by ID"
)
def delete_testcase(
    test_case_id: UUID,
    service: TestCaseService = Depends(get_service)
):
    success = service.delete(test_case_id)
    if not success:
        raise HTTPException(status_code=404, detail="Test case not found")


@router.post(
    "/bulk-move-suite",
    status_code=status.HTTP_200_OK,
    summary="Bulk move test cases to a suite",
)
def bulk_move_suite(data: BulkMoveSuiteRequest, service: TestCaseService = Depends(get_service)):
    moved = service.bulk_move_suite(data.case_ids, data.target_suite_id)
    return {"moved": moved}


@router.post(
    "/batch-reorder",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Reorder test cases within a suite",
)
def batch_reorder(data: BatchReorderRequest, service: TestCaseService = Depends(get_service)):
    service.batch_reorder(data.ordered_ids)