from pydantic import BaseModel
from uuid import UUID
from typing import Optional, List
from datetime import datetime


class ChecklistItemSchema(BaseModel):
    id: str
    text: str


class ChecklistBase(BaseModel):
    title: str
    items: List[ChecklistItemSchema] = []


class ChecklistCreate(ChecklistBase):
    project_id: UUID


class ChecklistUpdate(BaseModel):
    title: Optional[str] = None
    items: Optional[List[ChecklistItemSchema]] = None


class ChecklistResponse(ChecklistBase):
    id: UUID
    project_id: UUID
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ── Привязка чек-листа к тестовому прогону ──

class RunChecklistAttach(BaseModel):
    checklist_id: UUID


class RunChecklistItemsUpdate(BaseModel):
    checked_items: List[str]


class RunChecklistResponse(BaseModel):
    checklist_id: UUID
    title: str
    items: List[ChecklistItemSchema]
    checked_items: List[str]
