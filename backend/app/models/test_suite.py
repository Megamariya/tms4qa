import uuid

from sqlalchemy import Column, String, ForeignKey, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.base import Base


class TestSuite(Base):
    __tablename__ = "test_suites"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)

    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("test_suites.id"), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # ── Relationships ──
    project = relationship("Project", back_populates="testsuites")

    parent = relationship("TestSuite", remote_side=[id], backref="children")

    test_cases = relationship(
        "TestCase",
        back_populates="test_suite",
        cascade="all, delete",
    )
