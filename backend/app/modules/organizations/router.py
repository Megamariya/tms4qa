# project_name/backend/app/modules/organizations/router.py

import uuid as _uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from uuid import UUID

from app.core.dependencies import get_db, get_current_user
from app.core.security import require_roles
from app.modules.organizations.schemas import (
    OrganizationCreate,
    OrganizationOwnerUpdate,
    OrganizationOut
)
from app.modules.organizations.service import OrganizationService
from app.models.organization import Organization


router = APIRouter(prefix="/organizations", tags=["Организации"])


class OrgAdminCreate(BaseModel):
    name: str
    owner_email: str
    owner_password: str
    owner_first_name: str = ""
    owner_last_name: str = ""

service = OrganizationService()


@router.post("/", response_model=OrganizationOut)
def create_organization(
    data: OrganizationCreate,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    user_id = UUID(user["id"])
    return service.create(db, data, user_id)


@router.get("/", response_model=list[OrganizationOut], summary="Get organizations (Возвращает список всех организаций)", description="Returns list of all organizations")
def list_organizations(
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    user_id = UUID(user["id"])
    return service.list_by_user(db, user_id)


@router.get("/{org_id}", response_model=OrganizationOut)
def get_organization(
    org_id: UUID,
    db: Session = Depends(get_db),
    user=Depends(get_current_user)
):
    from app.models.organization import Organization

    user_role = user.get("role", "")
    user_org_id = user.get("organization_id")

    if user_role == "SUPER_ADMIN":
        org = db.query(Organization).filter(Organization.id == org_id).first()
    elif user_org_id and str(org_id) == str(user_org_id):
        # любой пользователь может получить свою организацию
        org = db.query(Organization).filter(Organization.id == org_id).first()
    else:
        user_id = UUID(user["id"])
        org = service.get(db, org_id, user_id)

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    return org


@router.patch("/{org_id}/settings",
              response_model=OrganizationOut,
              summary="[OWNER] Update org settings (website_url)")
def owner_update_org_settings(
    org_id: UUID,
    data: OrganizationOwnerUpdate,
    db: Session = Depends(get_db),
    user: dict = Depends(get_current_user),
):
    role = user.get("role", "")
    if role not in ("OWNER", "SUPER_ADMIN"):
        raise HTTPException(status_code=403, detail="Forbidden")
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    if data.website_url is not None:
        org.website_url = data.website_url or None
    db.commit()
    db.refresh(org)
    return org


@router.delete("/{org_id}")
def delete_organization(org_id: UUID, db: Session = Depends(get_db)):
    org = db.query(Organization).filter(Organization.id == org_id).first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    db.delete(org)
    db.commit()

    return {"status": "deleted"}


# ─────────────────────────────────────────────────────────────────────────────
# SUPER_ADMIN endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/admin/all",
            response_model=list[OrganizationOut],
            summary="[SUPER_ADMIN] List all organizations")
def admin_list_all(
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles(["SUPER_ADMIN"])),
):
    return db.query(Organization).all()


@router.post("/admin/create",
             response_model=OrganizationOut,
             summary="[SUPER_ADMIN] Create org with OWNER user")
def admin_create_org(
    data: OrgAdminCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles(["SUPER_ADMIN"])),
):
    from app.models.user import User
    from app.models.enums import UserRole
    from app.core.security import hash_password

    # Create org
    org = Organization(id=_uuid.uuid4(), name=data.name)
    db.add(org)
    db.flush()

    # Create OWNER user
    owner = User(
        id=_uuid.uuid4(),
        email=data.owner_email,
        username=None,
        first_name=data.owner_first_name,
        last_name=data.owner_last_name,
        name=f"{data.owner_first_name} {data.owner_last_name}".strip() or data.owner_email,
        password_hash=hash_password(data.owner_password),
        role=UserRole.OWNER,
        organization_id=org.id,
        is_active=True,
    )
    db.add(owner)
    db.commit()
    db.refresh(org)

    from app.modules.auth.service import log_action
    log_action(db, actor_id=owner.id, action="create_organization",
               entity_type="organization", entity_id=str(org.id))
    return org


@router.patch("/admin/{org_id}",
              response_model=OrganizationOut,
              summary="[SUPER_ADMIN] Update org name")
def admin_update_org(
    org_id: UUID,
    data: OrganizationCreate,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles(["SUPER_ADMIN"])),
):
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Not found")
    org.name = data.name
    db.commit()
    db.refresh(org)
    return org


@router.delete("/admin/{org_id}",
               summary="[SUPER_ADMIN] Delete org")
def admin_delete_org(
    org_id: UUID,
    db: Session = Depends(get_db),
    _: dict = Depends(require_roles(["SUPER_ADMIN"])),
):
    org = db.query(Organization).filter(Organization.id == org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail="Not found")
    db.delete(org)
    db.commit()
    return {"status": "deleted"}