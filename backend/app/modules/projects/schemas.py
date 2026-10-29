from pydantic import BaseModel, Field
from typing import Optional
from uuid import UUID
from datetime import datetime


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    abbreviation: Optional[str] = Field(default=None, max_length=16)
    description: Optional[str] = None
    is_private: bool = True


class ProjectUpdate(BaseModel):
    name: Optional[str] = Field(default=None, max_length=255)
    abbreviation: Optional[str] = Field(default=None, max_length=16)
    description: Optional[str] = None
    is_private: Optional[bool] = None


class ProjectOut(BaseModel):
    id: UUID
    name: str
    abbreviation: Optional[str] = None
    description: Optional[str] = None
    is_private: bool
    case_count: int = 0
    organization_id: Optional[UUID] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
