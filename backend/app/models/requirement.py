from sqlalchemy import String, ForeignKey, Column, Table, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from uuid import UUID
from typing import Optional

from app.db.base_model import Base, BaseModel


# Many-to-many: одно требование покрывается N кейсами, кейс может покрывать N требований.
requirement_testcases = Table(
    "requirement_testcases",
    Base.metadata,
    Column("requirement_id", PG_UUID(as_uuid=True), ForeignKey("requirements.id", ondelete="CASCADE"), primary_key=True),
    Column("test_case_id", PG_UUID(as_uuid=True), ForeignKey("test_cases.id", ondelete="CASCADE"), primary_key=True),
)

# req_type values: epic | feature | story | requirement
# status values: new | in_progress | completed | reviewed | deprecated


class Requirement(BaseModel):
    __tablename__ = "requirements"

    title: Mapped[str] = mapped_column(String)
    description: Mapped[Optional[str]]

    external_id: Mapped[Optional[str]]   # id во внешнем трекере (Jira)
    source: Mapped[Optional[str]]        # jira / github / manual
    external_url: Mapped[Optional[str]]  # ссылка на задачу в Jira

    req_type: Mapped[Optional[str]]      # epic | feature | story | requirement
    parent_id: Mapped[Optional[UUID]] = mapped_column(
        ForeignKey("requirements.id", ondelete="SET NULL"), nullable=True
    )
    req_status: Mapped[Optional[str]] = mapped_column(String, default="draft")  # existing column
    status: Mapped[Optional[str]] = mapped_column(String, default="new")         # new column
    priority: Mapped[Optional[str]] = mapped_column(String, default="medium")
    display_seq: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    project_id: Mapped[UUID] = mapped_column(ForeignKey("projects.id"))

    test_cases = relationship(
        "TestCase",
        secondary=requirement_testcases,
        back_populates="requirements",
    )
