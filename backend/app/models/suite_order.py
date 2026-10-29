import uuid

from sqlalchemy import Column, UniqueConstraint, ForeignKey
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.sql import text

from app.db.base import Base


class SuiteOrder(Base):
    __tablename__ = "suite_orders"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    # {"root": ["uuid", ...], "children": {"parent_uuid": ["uuid", ...]}}
    order_data = Column(
        JSONB,
        nullable=False,
        server_default=text('\'{"root":[],"children":{}}\'::jsonb'),
    )

    __table_args__ = (
        UniqueConstraint("user_id", "project_id", name="uq_suite_order_user_project"),
    )
