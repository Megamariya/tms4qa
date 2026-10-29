# project_name/backend/app/models/test_case.py

import uuid

from sqlalchemy import Column, String, DateTime, ForeignKey, Boolean, Enum as SAEnum, Integer, Text
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.db.base import Base
from app.models.enums import (
    Severity,
    Priority,
    CaseStatus,
    CaseType,
    Behavior,
    Layer,
    AutomationStatus,
)


class TestCase(Base):
    __tablename__ = "test_cases"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"))
    test_suite_id = Column(UUID(as_uuid=True), ForeignKey("test_suites.id"), nullable=True)

    # Базовые
    name = Column(String, nullable=False)
    full_name = Column(String)
    description = Column(Text)
    pre_conditions = Column(Text)
    post_conditions = Column(Text)

    # Шаги — JSONB список объектов {action, data, expected, attachments}
    steps = Column(JSONB, default=list)

    # Атрибуты
    severity = Column(SAEnum(Severity, name="severity_enum"), default=Severity.normal, nullable=False)
    priority = Column(SAEnum(Priority, name="priority_enum"), default=Priority.not_set, nullable=False)
    status = Column(SAEnum(CaseStatus, name="case_status_enum"), default=CaseStatus.actual, nullable=False)
    type = Column(SAEnum(CaseType, name="case_type_enum"), default=CaseType.other, nullable=False)
    behavior = Column(SAEnum(Behavior, name="behavior_enum"), default=Behavior.not_set, nullable=False)
    layer = Column(SAEnum(Layer, name="layer_enum"), default=Layer.not_set, nullable=False)
    automation_status = Column(
        SAEnum(AutomationStatus, name="automation_status_enum"),
        default=AutomationStatus.manual,
        nullable=False,
    )

    is_flaky = Column(Boolean, default=False, nullable=False)
    muted = Column(Boolean, default=False, nullable=False)
    is_deleted = Column(Boolean, default=False, nullable=False)

    # Метаданные
    framework = Column(String)
    tags = Column(JSONB, default=list)        # ["regression", "smoke"]
    labels = Column(JSONB, default=dict)      # {"epic": "...", "feature": "...", "story": "..."}

    # Версионирование
    revision = Column(Integer, default=1, nullable=False)

    # Стабильный порядковый номер в рамках проекта (TC-N, не меняется)
    display_seq = Column(Integer, nullable=True)
    # Порядок отображения внутри сьюта (для drag-n-drop, меняется)
    display_order = Column(Integer, default=0, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # ── Relationships ──
    project = relationship("Project", back_populates="testcases")

    test_suite = relationship("TestSuite", back_populates="test_cases")

    requirements = relationship(
        "Requirement",
        secondary="requirement_testcases",
        back_populates="test_cases",
    )

    results = relationship("TestResult", back_populates="test_case", cascade="all, delete-orphan")
