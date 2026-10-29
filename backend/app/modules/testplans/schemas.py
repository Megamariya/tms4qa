from datetime import date, datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.enums import PlanStatus


class TestPlanCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    references: Optional[str] = None
    project_id: UUID
    milestone_id: Optional[UUID] = None
    release_id: Optional[UUID] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: PlanStatus = PlanStatus.active


class TestPlanUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=255)
    description: Optional[str] = None
    references: Optional[str] = None
    milestone_id: Optional[UUID] = None
    release_id: Optional[UUID] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    status: Optional[PlanStatus] = None


class TestPlanResponse(BaseModel):
    id: UUID
    display_id: str
    name: str
    description: Optional[str] = None
    references: Optional[str] = None
    project_id: UUID
    milestone_id: Optional[UUID] = None
    release_id: Optional[UUID] = None
    status: PlanStatus = PlanStatus.active
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    created_at: datetime
    updated_at: Optional[datetime] = None
    case_count: int = 0
    run_count: int = 0

    class Config:
        from_attributes = True


class AddSuiteRequest(BaseModel):
    suite_id: UUID


class SetCasesRequest(BaseModel):
    case_ids: list[UUID]


class TestPlanHistoryEntry(BaseModel):
    id: UUID
    action: str
    actor_name: Optional[str] = None
    actor_email: Optional[str] = None
    details: Optional[dict] = None
    created_at: datetime

    class Config:
        from_attributes = True


class TestPlanStats(BaseModel):
    total_cases: int
    untested: int
    passed: int
    failed: int
    blocked: int
    skipped: int
    automation_passed: int
    automation_failed: int
    automation_error: int
    passed_rate: float
    completion_rate: float
