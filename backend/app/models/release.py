import uuid
from sqlalchemy import Column, String, ForeignKey, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from app.db.base import Base


class Release(Base):
    __tablename__ = "releases"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    name = Column(String(255), nullable=False)
    version = Column(String(100), nullable=False, server_default="")
    description = Column(Text, nullable=True)
    environment = Column(String(50), nullable=True)
    status = Column(String(50), nullable=False, server_default="planned")
    release_date = Column(String(20), nullable=True)
    requirement_ids = Column(JSONB, nullable=False, server_default="[]")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
