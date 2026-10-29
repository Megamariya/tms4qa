from pydantic import BaseModel
from uuid import UUID
from typing import Optional


REQ_TYPES = ["epic", "feature", "story", "requirement"]
REQ_STATUSES = ["draft", "approved", "in_progress", "ready_for_qa", "tested", "rejected"]


class RequirementBase(BaseModel):
    title: str
    description: Optional[str] = None
    external_id: Optional[str] = None
    source: Optional[str] = None
    external_url: Optional[str] = None
    req_type: Optional[str] = "requirement"
    parent_id: Optional[UUID] = None
    status: Optional[str] = "draft"
    priority: Optional[str] = "medium"


class RequirementCreate(RequirementBase):
    project_id: UUID


class RequirementUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    external_id: Optional[str] = None
    source: Optional[str] = None
    external_url: Optional[str] = None
    req_type: Optional[str] = None
    parent_id: Optional[UUID] = None
    status: Optional[str] = None
    priority: Optional[str] = None


class RequirementResponse(RequirementBase):
    id: UUID
    project_id: UUID
    display_seq: Optional[int] = None
    case_count: int = 0

    class Config:
        from_attributes = True


class LinkCasesRequest(BaseModel):
    case_ids: list[UUID]
