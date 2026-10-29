# project_name/backend/app/core/models/user_organization.py


import uuid
from sqlalchemy import Column, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from app.db.base import Base


class UserOrganization(Base):
    __tablename__ = "user_organizations"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True)
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"), primary_key=True)

    role = Column(String, default="member")  # owner / admin / tester