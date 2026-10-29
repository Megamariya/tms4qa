from pydantic import BaseModel
from uuid import UUID
from typing import Optional


class TestSuiteCreate(BaseModel):
    name: str
    description: Optional[str] = None
    project_id: UUID
    parent_id: Optional[UUID] = None


class TestSuiteUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    parent_id: Optional[UUID] = None


class TestSuiteResponse(BaseModel):
    id: UUID
    name: str
    description: Optional[str]
    project_id: UUID
    parent_id: Optional[UUID]

    class Config:
        from_attributes = True
