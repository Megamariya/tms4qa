import uuid

from sqlalchemy import Column, String, ForeignKey, DateTime
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.base import Base


class Checklist(Base):
    __tablename__ = "checklists"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    title = Column(String(255), nullable=False)

    # [{"id": "...", "text": "..."}, ...] — по аналогии со steps в TestCase
    items = Column(JSONB, server_default="[]", nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class TestRunChecklist(Base):
    """M2M: прогон ↔ чек-лист. checked_items — состояние выполнения именно
    в рамках этого прогона (id пунктов чек-листа, отмеченных как выполненные)."""

    __tablename__ = "test_run_checklists"

    run_id = Column(UUID(as_uuid=True), ForeignKey("test_runs.id", ondelete="CASCADE"), primary_key=True)
    checklist_id = Column(UUID(as_uuid=True), ForeignKey("checklists.id", ondelete="CASCADE"), primary_key=True)

    checked_items = Column(JSONB, server_default="[]", nullable=False)
    added_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    checklist = relationship("Checklist")
