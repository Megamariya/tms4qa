from __future__ import annotations

from pydantic import BaseModel
from uuid import UUID
from typing import Optional, List
from datetime import date, datetime


class TodoBase(BaseModel):
    type: str = "task"
    title: str
    body: Optional[str] = None
    status: str = "todo"
    priority: str = "medium"
    due_date: Optional[date] = None
    tags: List[str] = []
    jira_url: Optional[str] = None
    requirement_id: Optional[UUID] = None


class TodoCreate(TodoBase):
    project_id: UUID


class TodoUpdate(BaseModel):
    type: Optional[str] = None
    title: Optional[str] = None
    body: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    due_date: Optional[date] = None
    tags: Optional[List[str]] = None
    jira_url: Optional[str] = None
    requirement_id: Optional[UUID] = None


class TodoResponse(TodoBase):
    id: UUID
    project_id: UUID
    created_at: datetime
    updated_at: Optional[datetime] = None
    requirement_title: Optional[str] = None

    class Config:
        from_attributes = True
