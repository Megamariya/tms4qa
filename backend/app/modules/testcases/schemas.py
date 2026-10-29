from pydantic import BaseModel, Field
from uuid import UUID
from typing import Optional, Any

from app.models.enums import (
    Severity,
    Priority,
    CaseStatus,
    CaseType,
    Behavior,
    Layer,
    AutomationStatus,
)


class Step(BaseModel):
    action: str
    data: Optional[str] = None
    expected: Optional[str] = None
    expected_results: list[str] = Field(default_factory=list)
    attachments: list[str] = Field(default_factory=list)
    # API layer fields
    api_method: Optional[str] = None
    api_url: Optional[str] = None
    api_expected_status: Optional[int] = None
    api_contract: Optional[str] = None


class TestCaseBase(BaseModel):
    name: str
    full_name: Optional[str] = None
    description: Optional[str] = None
    pre_conditions: Optional[str] = None
    post_conditions: Optional[str] = None
    steps: list[Step] = Field(default_factory=list)

    severity: Severity = Severity.normal
    priority: Priority = Priority.not_set
    status: CaseStatus = CaseStatus.actual
    type: CaseType = CaseType.other
    behavior: Behavior = Behavior.not_set
    layer: Layer = Layer.not_set
    automation_status: AutomationStatus = AutomationStatus.manual

    is_flaky: bool = False
    muted: bool = False

    framework: Optional[str] = None
    tags: list[str] = Field(default_factory=list)
    labels: dict[str, Any] = Field(default_factory=dict)


class TestCaseCreate(TestCaseBase):
    project_id: UUID
    test_suite_id: Optional[UUID] = None


class TestCaseUpdate(BaseModel):
    name: Optional[str] = None
    full_name: Optional[str] = None
    description: Optional[str] = None
    pre_conditions: Optional[str] = None
    post_conditions: Optional[str] = None
    steps: Optional[list[Step]] = None

    severity: Optional[Severity] = None
    priority: Optional[Priority] = None
    status: Optional[CaseStatus] = None
    type: Optional[CaseType] = None
    behavior: Optional[Behavior] = None
    layer: Optional[Layer] = None
    automation_status: Optional[AutomationStatus] = None

    is_flaky: Optional[bool] = None
    muted: Optional[bool] = None

    framework: Optional[str] = None
    tags: Optional[list[str]] = None
    labels: Optional[dict[str, Any]] = None
    test_suite_id: Optional[UUID] = None


class TestCaseResponse(TestCaseBase):
    id: UUID
    project_id: UUID
    test_suite_id: Optional[UUID]
    revision: int
    display_seq: Optional[int] = None
    display_order: int = 0

    class Config:
        from_attributes = True


class BulkMoveSuiteRequest(BaseModel):
    case_ids: list[UUID]
    target_suite_id: Optional[UUID] = None


class BatchReorderRequest(BaseModel):
    ordered_ids: list[UUID]
