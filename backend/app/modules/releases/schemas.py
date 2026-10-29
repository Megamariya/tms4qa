from pydantic import BaseModel
from uuid import UUID
from typing import Optional, List
from datetime import datetime


class ReleaseCreate(BaseModel):
    project_id: UUID
    name: str
    version: str = ""
    description: Optional[str] = None
    environment: Optional[str] = None
    status: str = "planned"
    release_date: Optional[str] = None
    requirement_ids: List[str] = []


class ReleaseUpdate(BaseModel):
    name: Optional[str] = None
    version: Optional[str] = None
    description: Optional[str] = None
    environment: Optional[str] = None
    status: Optional[str] = None
    release_date: Optional[str] = None
    requirement_ids: Optional[List[str]] = None


class ReleaseResponse(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    version: str
    description: Optional[str] = None
    environment: Optional[str] = None
    status: str
    release_date: Optional[str] = None
    requirement_ids: List[str] = []
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
