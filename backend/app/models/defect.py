import uuid

from sqlalchemy import Column, String, ForeignKey, DateTime, Text, Table, Enum as SAEnum, Integer
from sqlalchemy.dialects.postgresql import UUID, ARRAY, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.base import Base
from app.models.enums import Severity, Priority, DefectStatus


defect_results = Table(
    "defect_results",
    Base.metadata,
    Column("defect_id", UUID(as_uuid=True), ForeignKey("defects.id", ondelete="CASCADE"), primary_key=True),
    Column("result_id", UUID(as_uuid=True), ForeignKey("test_results.id", ondelete="CASCADE"), primary_key=True),
)


class Defect(Base):
    __tablename__ = "defects"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    display_seq = Column(Integer, nullable=False, default=1)

    title = Column(String(255), nullable=False)
    impact = Column(String(50), nullable=True)
    steps_to_reproduce = Column(Text, nullable=True)
    expected_result = Column(Text, nullable=True)
    actual_result = Column(Text, nullable=True)
    description = Column(Text)
    environment = Column(String(50), nullable=True)
    tags = Column(ARRAY(Text), nullable=True, default=[])
    # Ссылки на файлы в MinIO: ["/api/v1/attachments/{id}/file/{name}", ...]
    attachments = Column(JSONB, server_default="[]", nullable=False, default=list)

    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    release_id = Column(UUID(as_uuid=True), nullable=True)
    # Прогон, в рамках которого найден дефект (фильтр/группировка на странице Defects)
    test_run_id = Column(UUID(as_uuid=True), ForeignKey("test_runs.id", ondelete="SET NULL"), nullable=True, index=True)

    severity = Column(SAEnum(Severity, name="severity_enum"), default=Severity.normal, nullable=False)
    priority = Column(SAEnum(Priority, name="priority_enum"), default=Priority.not_set, nullable=False)
    status = Column(SAEnum(DefectStatus, name="defect_status_enum"), default=DefectStatus.open, nullable=False)

    reporter_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    assignee_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    pre_conditions = Column(Text, nullable=True)

    external_id = Column(String(255))
    external_url = Column(String(512))

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    project = relationship("Project")
    reporter = relationship("User", foreign_keys=[reporter_id])
    assignee = relationship("User", foreign_keys=[assignee_id])
    test_run = relationship("TestRun")

    results = relationship(
        "TestResult",
        secondary="defect_results",
        back_populates="defects",
    )
