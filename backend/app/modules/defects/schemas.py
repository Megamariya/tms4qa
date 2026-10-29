from pydantic import BaseModel
from uuid import UUID
from typing import Optional, List
from datetime import datetime

from app.models.enums import Severity, Priority, DefectStatus


class DefectBase(BaseModel):
    title: str
    impact: Optional[str] = None
    steps_to_reproduce: Optional[str] = None
    expected_result: Optional[str] = None
    actual_result: Optional[str] = None
    description: Optional[str] = None
    environment: Optional[str] = None
    severity: Severity = Severity.normal
    priority: Priority = Priority.not_set
    tags: List[str] = []
    pre_conditions: Optional[str] = None
    external_id: Optional[str] = None
    external_url: Optional[str] = None
    attachments: List[str] = []


class DefectCreate(DefectBase):
    project_id: UUID
    reporter_id: Optional[UUID] = None
    assignee_id: Optional[UUID] = None
    release_id: Optional[UUID] = None
    test_run_id: Optional[UUID] = None
    # Результат прогона, из которого заведён дефект (заполняет defect_results)
    test_result_id: Optional[UUID] = None


class DefectUpdate(BaseModel):
    title: Optional[str] = None
    impact: Optional[str] = None
    steps_to_reproduce: Optional[str] = None
    expected_result: Optional[str] = None
    actual_result: Optional[str] = None
    description: Optional[str] = None
    environment: Optional[str] = None
    severity: Optional[Severity] = None
    priority: Optional[Priority] = None
    status: Optional[DefectStatus] = None
    assignee_id: Optional[UUID] = None
    release_id: Optional[UUID] = None
    test_run_id: Optional[UUID] = None
    tags: Optional[List[str]] = None
    pre_conditions: Optional[str] = None
    external_id: Optional[str] = None
    external_url: Optional[str] = None
    attachments: Optional[List[str]] = None


class DefectResponse(DefectBase):
    id: UUID
    display_seq: int
    display_id: str
    project_id: UUID
    status: DefectStatus
    reporter_id: Optional[UUID] = None
    assignee_id: Optional[UUID] = None
    release_id: Optional[UUID] = None
    test_run_id: Optional[UUID] = None
    test_run_name: Optional[str] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True

    @classmethod
    def from_orm_with_display(cls, obj):
        return cls(
            id=obj.id,
            display_seq=obj.display_seq,
            display_id=f"D-{obj.display_seq}",
            title=obj.title,
            impact=obj.impact,
            steps_to_reproduce=obj.steps_to_reproduce,
            expected_result=obj.expected_result,
            actual_result=obj.actual_result,
            description=obj.description,
            environment=obj.environment,
            severity=obj.severity,
            priority=obj.priority,
            tags=obj.tags or [],
            pre_conditions=obj.pre_conditions,
            external_id=obj.external_id,
            external_url=obj.external_url,
            attachments=obj.attachments or [],
            project_id=obj.project_id,
            status=obj.status,
            reporter_id=obj.reporter_id,
            assignee_id=obj.assignee_id,
            release_id=obj.release_id,
            test_run_id=obj.test_run_id,
            test_run_name=obj.test_run.name if obj.test_run else None,
            created_at=obj.created_at,
            updated_at=obj.updated_at,
        )
