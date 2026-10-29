from sqlalchemy import Column, String, Integer, ForeignKey
from sqlalchemy.dialects.postgresql import UUID

from app.db.base_model import BaseModel


class Attachment(BaseModel):
    __tablename__ = "attachments"

    project_id = Column(UUID(as_uuid=True), ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    entity_type = Column(String(50), nullable=False)   # "test_result" | "defect" | "test_case"
    entity_id = Column(String(36), nullable=False)
    filename = Column(String(255), nullable=False)
    bucket_key = Column(String(500), nullable=False)
    size = Column(Integer, nullable=False, default=0)
    content_type = Column(String(100), nullable=True)
