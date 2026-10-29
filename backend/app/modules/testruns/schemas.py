from pydantic import BaseModel
from uuid import UUID
from typing import Optional
from datetime import datetime

from app.models.enums import RunStatus, ResultStatus


class TestRunBase(BaseModel):
    name: str
    description: Optional[str] = None
    environment: Optional[str] = None
    configuration: Optional[str] = None
    device_type: Optional[str] = None
    os: Optional[str] = None
    os_version: Optional[str] = None


class TestRunCreate(TestRunBase):
    project_id: UUID
    test_plan_id: Optional[UUID] = None
    release_id: Optional[UUID] = None
    test_case_ids: Optional[list[UUID]] = None  # явный список кейсов; иначе берём из плана/проекта


class TestRunUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    environment: Optional[str] = None
    configuration: Optional[str] = None
    status: Optional[RunStatus] = None
    release_id: Optional[UUID] = None
    device_type: Optional[str] = None
    os: Optional[str] = None
    os_version: Optional[str] = None


class TestRunResponse(TestRunBase):
    id: UUID
    project_id: UUID
    test_plan_id: Optional[UUID]
    release_id: Optional[UUID] = None
    status: RunStatus
    hold_reason: Optional[str] = None
    started_by: Optional[UUID]
    started_by_name: Optional[str] = None
    started_at: datetime
    completed_at: Optional[datetime]
    # device_type, os, os_version inherited from TestRunBase

    class Config:
        from_attributes = True


class TestRunStats(BaseModel):
    """Распределение результатов по статусам — для полосы TEST RUN STATS."""
    total: int
    passed: int
    failed: int
    blocked: int
    skipped: int
    invalid: int
    untested: int


class TestRunWithStats(TestRunResponse):
    stats: TestRunStats


# ── TestResult ──

class TestResultBase(BaseModel):
    status: ResultStatus = ResultStatus.untested
    comment: Optional[str] = None
    actual_result: Optional[str] = None
    time_spent_ms: int = 0


class TestResultCreate(TestResultBase):
    test_case_id: UUID


class TestResultUpdate(BaseModel):
    status: Optional[ResultStatus] = None
    comment: Optional[str] = None
    actual_result: Optional[str] = None
    time_spent_ms: Optional[int] = None
    attachments: Optional[dict] = None


class TestResultResponse(TestResultBase):
    id: UUID
    run_id: UUID
    test_case_id: UUID
    sequence: Optional[int] = None
    executor_id: Optional[UUID]
    executed_at: Optional[datetime]
    attachments: Optional[dict] = None

    class Config:
        from_attributes = True


class SetRunCasesRequest(BaseModel):
    case_ids: list[UUID]


class ReorderResultsRequest(BaseModel):
    result_ids: list[UUID]
