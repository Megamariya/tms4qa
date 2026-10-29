#project_name/backend/app/core/models/organization.py

import uuid
from sqlalchemy import Column, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy import Column, String, ForeignKey
from app.db.base import Base


class Organization(Base):
    __tablename__ = "organizations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String, nullable=False)
    website_url = Column(String, nullable=True)
