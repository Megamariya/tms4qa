import uuid
from sqlalchemy import Column, String, Boolean, ForeignKey, DateTime, Enum as SAEnum
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from app.db.base import Base
from app.models.enums import UserRole


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    # Legacy field — kept for backward compat
    name = Column(String, nullable=True)
    keycloak_id = Column(String, unique=True, nullable=True)
    # Auth fields
    email = Column(String, unique=True, nullable=False)
    username = Column(String, unique=True, nullable=True)
    password_hash = Column(String, nullable=True)
    first_name = Column(String, nullable=True)
    last_name = Column(String, nullable=True)
    # Org & role
    organization_id = Column(UUID(as_uuid=True), ForeignKey("organizations.id"), nullable=True)
    role = Column(SAEnum(UserRole, name="user_role_enum", create_type=False), nullable=True, default=UserRole.TESTER)
    # Contact
    phone = Column(String, nullable=True)
    telegram = Column(String, nullable=True)
    # Status
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=True)
    updated_at = Column(DateTime(timezone=True), nullable=True)

    @property
    def display_name(self) -> str:
        if self.first_name or self.last_name:
            return f"{self.first_name or ''} {self.last_name or ''}".strip()
        return self.name or self.username or self.email
