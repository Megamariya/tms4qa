import uuid

from sqlalchemy import Column, String, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from sqlalchemy import DateTime

from app.db.base import Base


class SharedStepFolder(Base):
    __tablename__ = "shared_step_folders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())


class SharedStep(Base):
    __tablename__ = "shared_steps"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True)
    folder_id = Column(UUID(as_uuid=True), ForeignKey("shared_step_folders.id", ondelete="SET NULL"), nullable=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    steps = Column(JSONB, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
