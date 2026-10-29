# project_name/backend/app/models/project.py

from sqlalchemy import Column, String, ForeignKey, Boolean, Text
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import UUID

from app.db.base_model import BaseModel


class Project(BaseModel):
    __tablename__ = "projects"

    name = Column(String(255), nullable=False)
    abbreviation = Column(String(16), nullable=True)
    description = Column(Text, nullable=True)
    is_private = Column(Boolean, default=True, nullable=False)

    organization_id = Column(
        UUID(as_uuid=True),
        ForeignKey("organizations.id"),
        nullable=False,
    )

    organization = relationship("Organization", backref="projects")

    testcases = relationship(
        "TestCase",
        back_populates="project",
        cascade="all, delete",
    )

    testsuites = relationship(
        "TestSuite",
        back_populates="project",
        cascade="all, delete",
    )
