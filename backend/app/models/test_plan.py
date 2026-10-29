import uuid

from sqlalchemy import Column, String, ForeignKey, Table, Text, Date, DateTime, Integer, Index, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.db.base import Base
from app.models.enums import PlanStatus


# M2M: план ↔ suites (план — статическая выборка кейсов через suites)
testplan_suites = Table(
    "testplan_suites",
    Base.metadata,
    Column("testplan_id", UUID(as_uuid=True), ForeignKey("test_plans.id", ondelete="CASCADE"), primary_key=True),
    Column("suite_id", UUID(as_uuid=True), ForeignKey("test_suites.id", ondelete="CASCADE"), primary_key=True),
)

testplan_cases = Table(
    "testplan_cases",
    Base.metadata,
    Column("plan_id", UUID(as_uuid=True), ForeignKey("test_plans.id", ondelete="CASCADE"), primary_key=True),
    Column("case_id", UUID(as_uuid=True), ForeignKey("test_cases.id", ondelete="CASCADE"), primary_key=True),
    # Порядок кейса внутри плана — управляется вручную (drag/▲▼) на странице плана
    # и наследуется прогоном при создании (TestResult.sequence).
    Column("position", Integer, nullable=False, server_default="0"),
)


class TestPlan(Base):
    __tablename__ = "test_plans"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    name = Column(String(255), nullable=False)
    description = Column(Text)
    references = Column(Text)  # свободный текст со ссылками на тикеты

    # Display ID в формате R{N}, уникален в рамках проекта
    display_seq = Column(Integer, nullable=False)

    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id"), nullable=False)
    milestone_id = Column(UUID(as_uuid=True), nullable=True)  # заглушка под будущую таблицу milestones
    release_id = Column(UUID(as_uuid=True), nullable=True)

    status = Column(SAEnum(PlanStatus, name="plan_status_enum"), default=PlanStatus.active, nullable=False, server_default="active")

    start_date = Column(Date, nullable=True)
    end_date = Column(Date, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    suites = relationship("TestSuite", secondary=testplan_suites)
    test_cases = relationship(
        "TestCase", secondary=testplan_cases, order_by=testplan_cases.c.position
    )

    __table_args__ = (
        Index("ix_test_plans_project_seq", "project_id", "display_seq", unique=True),
    )

    @property
    def display_id(self) -> str:
        return f"R{self.display_seq}"

    @property
    def case_count(self) -> int:
        return len(self.test_cases)
