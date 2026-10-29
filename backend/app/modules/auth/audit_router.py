"""Audit log endpoints (SUPER_ADMIN only)."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from uuid import UUID
from typing import Optional
from datetime import datetime

from app.core.dependencies import get_db
from app.core.security import require_roles
from app.models.audit_log import AuditLog

router = APIRouter(prefix="/audit", tags=["Audit"])


class AuditLogOut(BaseModel):
    id: UUID
    actor_id: Optional[UUID] = None
    actor_email: Optional[str] = None
    actor_name: Optional[str] = None
    action: str
    entity_type: Optional[str] = None
    entity_id: Optional[str] = None
    details: Optional[dict] = None
    ip_address: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


@router.get("/", response_model=list[AuditLogOut],
            summary="[SUPER_ADMIN] Get audit log")
def get_audit_log(
    limit: int = Query(50, le=1000),
    offset: int = Query(0),
    actor_id: Optional[UUID] = None,
    action: Optional[str] = None,
    org_id: Optional[UUID] = None,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles(["SUPER_ADMIN"])),
):
    from app.models.user import User

    q = (
        db.query(AuditLog, User.email, User.name)
        .outerjoin(User, User.id == AuditLog.actor_id)
    )
    if actor_id:
        q = q.filter(AuditLog.actor_id == actor_id)
    if action:
        q = q.filter(AuditLog.action == action)
    if org_id:
        q = q.filter(User.organization_id == org_id)

    rows = q.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()

    return [
        AuditLogOut(
            id=log.id,
            actor_id=log.actor_id,
            actor_email=email,
            actor_name=name,
            action=log.action,
            entity_type=log.entity_type,
            entity_id=log.entity_id,
            details=log.details,
            ip_address=log.ip_address,
            created_at=log.created_at,
        )
        for log, email, name in rows
    ]
