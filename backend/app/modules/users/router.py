import uuid as _uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from uuid import UUID

from app.core.dependencies import get_db, get_current_user
from app.core.security import require_roles
from . import schemas, service

router = APIRouter(prefix="/users", tags=["Users"])


@router.post("/", response_model=schemas.UserResponse)
def create_user(data: schemas.UserCreate, db: Session = Depends(get_db)):
    return service.create_user(db, data)


@router.get("/", response_model=list[schemas.UserFullResponse])
def get_users(db: Session = Depends(get_db)):
    return service.get_users(db)


# ─────────────────────────────────────────────────────────────────────────────
# OWNER / SUPER_ADMIN: manage users in org
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/org/{org_id}",
            response_model=list[schemas.UserFullResponse],
            summary="List users in organization (OWNER or SUPER_ADMIN)")
def list_org_users(
    org_id: UUID,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    role = current_user.get("role")
    if role not in ("SUPER_ADMIN", "OWNER"):
        raise HTTPException(status_code=403, detail="Access denied")
    if role == "OWNER" and current_user.get("organization_id") != str(org_id):
        raise HTTPException(status_code=403, detail="Access denied: wrong org")
    from app.models.user import User
    return db.query(User).filter(User.organization_id == org_id).all()


@router.post("/invite",
             response_model=schemas.UserFullResponse,
             summary="Invite user to org (OWNER or SUPER_ADMIN)")
def invite_user(
    data: schemas.UserInvite,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    role = current_user.get("role")
    if role not in ("SUPER_ADMIN", "OWNER"):
        raise HTTPException(status_code=403, detail="Access denied")
    if data.role == "SUPER_ADMIN" and role != "SUPER_ADMIN":
        raise HTTPException(status_code=403, detail="Cannot assign SUPER_ADMIN role")

    from app.models.user import User
    from app.models.enums import UserRole
    from app.core.security import hash_password

    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    org_id = current_user.get("organization_id")
    user = User(
        id=_uuid.uuid4(),
        email=data.email,
        username=data.username or None,
        first_name=data.first_name,
        last_name=data.last_name,
        name=f"{data.first_name or ''} {data.last_name or ''}".strip() or data.email,
        password_hash=hash_password(data.password),
        role=UserRole(data.role),
        organization_id=_uuid.UUID(org_id) if org_id else None,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    from app.modules.auth.service import log_action
    log_action(db, actor_id=_uuid.UUID(current_user["id"]), action="create_user",
               entity_type="user", entity_id=str(user.id))
    return user


@router.patch("/{user_id}/role",
              response_model=schemas.UserFullResponse,
              summary="Change user role (OWNER or SUPER_ADMIN)")
def update_user_role(
    user_id: UUID,
    data: schemas.UserRoleUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    role = current_user.get("role")
    if role not in ("SUPER_ADMIN", "OWNER"):
        raise HTTPException(status_code=403, detail="Access denied")
    if data.role == "SUPER_ADMIN" and role != "SUPER_ADMIN":
        raise HTTPException(status_code=403, detail="Cannot assign SUPER_ADMIN role")

    from app.models.user import User
    from app.models.enums import UserRole

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if role == "OWNER" and str(user.organization_id) != current_user.get("organization_id"):
        raise HTTPException(status_code=403, detail="Access denied: wrong org")

    old_role = user.role
    user.role = UserRole(data.role)
    db.commit()
    db.refresh(user)

    from app.modules.auth.service import log_action
    log_action(db, actor_id=_uuid.UUID(current_user["id"]), action="change_role",
               entity_type="user", entity_id=str(user_id),
               details={"from": str(old_role), "to": data.role})
    return user


@router.patch("/{user_id}/contact",
              response_model=schemas.UserFullResponse,
              summary="Update user contact info (email, phone, telegram) — OWNER or SUPER_ADMIN")
def update_user_contact(
    user_id: UUID,
    data: schemas.UserContactUpdate,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    role = current_user.get("role")
    if role not in ("SUPER_ADMIN", "OWNER"):
        raise HTTPException(status_code=403, detail="Access denied")

    from app.models.user import User

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if role == "OWNER" and str(user.organization_id) != current_user.get("organization_id"):
        raise HTTPException(status_code=403, detail="Access denied: wrong org")

    if data.email is not None:
        existing = db.query(User).filter(User.email == data.email, User.id != user_id).first()
        if existing:
            raise HTTPException(status_code=409, detail="Email already in use")
        user.email = data.email
    if data.phone is not None:
        user.phone = data.phone
    if data.telegram is not None:
        user.telegram = data.telegram

    db.commit()
    db.refresh(user)

    from app.modules.auth.service import log_action
    log_action(db, actor_id=_uuid.UUID(current_user["id"]), action="update_contact",
               entity_type="user", entity_id=str(user_id))
    return user


@router.patch("/{user_id}/deactivate",
              response_model=schemas.UserFullResponse,
              summary="Deactivate user (OWNER or SUPER_ADMIN)")
def deactivate_user(
    user_id: UUID,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    role = current_user.get("role")
    if role not in ("SUPER_ADMIN", "OWNER"):
        raise HTTPException(status_code=403, detail="Access denied")

    from app.models.user import User
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if role == "OWNER" and str(user.organization_id) != current_user.get("organization_id"):
        raise HTTPException(status_code=403, detail="Access denied: wrong org")

    user.is_active = False
    db.commit()
    db.refresh(user)

    from app.modules.auth.service import log_action
    log_action(db, actor_id=_uuid.UUID(current_user["id"]), action="deactivate_user",
               entity_type="user", entity_id=str(user_id))
    return user
