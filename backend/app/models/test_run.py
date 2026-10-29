import uuid

from sqlalchemy import Column, String, ForeignKey, DateTime, Text, Enum as SAEnum, BigInteger, Integer
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.base import Base
from app.models.enums import RunStatus, ResultStatus


class TestRun(Base):
    __tablename__ = "test_runs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    name = Column(String(255), nullable=False)
    description = Column(Text)

    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    test_plan_id = Column(UUID(as_uuid=True), ForeignKey("test_plans.id"), nullable=True)

    status = Column(SAEnum(RunStatus, name="run_status_enum"), default=RunStatus.ready_to_start, nullable=False)
    hold_reason = Column(Text, nullable=True)

    environment = Column(String(255))   # денормализовано: пока без отдельной таблицы Environment
    configuration = Column(String(255))

    device_type = Column(String(50), nullable=True)   # mobile | pc | tablet | other
    os = Column(String(100), nullable=True)
    os_version = Column(String(50), nullable=True)

    release_id = Column(UUID(as_uuid=True), nullable=True)

    started_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    started_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    project = relationship("Project")
    plan = relationship("TestPlan")
    started_by_user = relationship("User", foreign_keys=[started_by])

    results = relationship("TestResult", back_populates="run", cascade="all, delete-orphan")


class TestResult(Base):
    __tablename__ = "test_results"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    run_id = Column(UUID(as_uuid=True), ForeignKey("test_runs.id"), nullable=False)
    test_case_id = Column(UUID(as_uuid=True), ForeignKey("test_cases.id"), nullable=False)

    # Порядок кейса внутри прогона — наследуется из порядка тест-плана / явного
    # списка test_case_ids на момент создания прогона (см. TestResultRepository).
    sequence = Column(Integer, nullable=True)

    status = Column(SAEnum(ResultStatus, name="result_status_enum"), default=ResultStatus.untested, nullable=False)

    executor_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    time_spent_ms = Column(BigInteger, default=0)

    comment = Column(Text)
    actual_result = Column(Text)
    attachments = Column(JSONB, server_default='{}', nullable=False)

    executed_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    run = relationship("TestRun", back_populates="results")
    test_case = relationship("TestCase", back_populates="results")
    executor = relationship("User", foreign_keys=[executor_id])

    defects = relationship(
        "Defect",
        secondary="defect_results",
        back_populates="results",
    )
