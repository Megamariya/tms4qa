from __future__ import annotations
from typing import Any, List, Optional
from uuid import UUID
from datetime import datetime
from pydantic import BaseModel


class SharedStepFolderCreate(BaseModel):
    project_id: UUID
    name: str


class SharedStepFolderUpdate(BaseModel):
    name: Optional[str] = None


class SharedStepFolderOut(BaseModel):
    id: UUID
    project_id: UUID
    name: str
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class SharedStepCreate(BaseModel):
    project_id: UUID
    folder_id: Optional[UUID] = None
    name: str
    description: Optional[str] = None
    steps: List[Any] = []


class SharedStepUpdate(BaseModel):
    folder_id: Optional[UUID] = None
    name: Optional[str] = None
    description: Optional[str] = None
    steps: Optional[List[Any]] = None


class SharedStepOut(BaseModel):
    id: UUID
    project_id: UUID
    folder_id: Optional[UUID] = None
    name: str
    description: Optional[str] = None
    steps: List[Any] = []
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
