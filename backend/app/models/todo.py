from sqlalchemy import Column, String, ForeignKey, Text, Date
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import text

from app.db.base_model import BaseModel


class TodoItem(BaseModel):
    __tablename__ = "todos"

    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    type = Column(String(20), nullable=False, default="task")
    title = Column(String(), nullable=False)
    body = Column(Text(), nullable=True)
    status = Column(String(20), nullable=False, default="todo")
    priority = Column(String(20), nullable=False, default="medium")
    due_date = Column(Date(), nullable=True)
    tags = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"), default=list)
    jira_url = Column(String(), nullable=True)
    requirement_id = Column(UUID(as_uuid=True), ForeignKey("requirements.id", ondelete="SET NULL"), nullable=True)
