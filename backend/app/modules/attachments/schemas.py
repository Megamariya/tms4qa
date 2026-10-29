from __future__ import annotations

from datetime import datetime
from uuid import UUID
from pydantic import BaseModel


class AttachmentResponse(BaseModel):
    id: UUID
    project_id: UUID
    entity_type: str
    entity_id: str
    filename: str
    url: str
    size: int
    content_type: str | None
    created_at: datetime

    class Config:
        from_attributes = True
