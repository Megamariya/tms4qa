# app/db/base_model.py

import uuid
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy import Column, DateTime
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import UUID


class Base(DeclarativeBase):
    pass


class BaseModel(Base):
    __abstract__ = True

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )

    updated_at = Column(
        DateTime(timezone=True),
        onupdate=func.now(),
    )