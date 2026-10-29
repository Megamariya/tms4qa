"""JWT utilities and RBAC dependency factory.

Replaces the old Keycloak-based security.py.
Uses HS256 (python-jose) + bcrypt (direct, no passlib).
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt as _bcrypt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal


def _get_db():
    """Local get_db to avoid circular import with dependencies.py."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# ─────────────────────────────────────────────────────────────────────────────
# Password hashing (bcrypt direct — avoids passlib/bcrypt version conflicts)
# ─────────────────────────────────────────────────────────────────────────────
def hash_password(plain: str) -> str:
    return _bcrypt.hashpw(plain.encode("utf-8"), _bcrypt.gensalt()).decode("utf-8")

def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False

# ─────────────────────────────────────────────────────────────────────────────
# JWT
# ─────────────────────────────────────────────────────────────────────────────
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

def create_access_token(data: dict[str, Any], expires_delta: timedelta | None = None) -> str:
    payload = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    payload["exp"] = expire
    payload["type"] = "access"
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)

def decode_access_token(token: str) -> dict[str, Any]:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
        return payload
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

# ─────────────────────────────────────────────────────────────────────────────
# Refresh token helpers (stored as SHA-256 hash in DB)
# ─────────────────────────────────────────────────────────────────────────────
def generate_refresh_token() -> str:
    return secrets.token_urlsafe(64)

def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()

# ─────────────────────────────────────────────────────────────────────────────
# get_current_user — real JWT version
# ─────────────────────────────────────────────────────────────────────────────
def get_current_user(
    request: Request,
    token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(_get_db),
) -> dict:
    """Validate Bearer JWT and return user dict.

    SUPER_ADMIN can pass X-Org-Id header to work in a specific org context.
    """
    from app.models.user import User  # local import avoids circular
    from app.models.enums import UserRole

    if token is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Not authenticated",
                            headers={"WWW-Authenticate": "Bearer"})

    payload = decode_access_token(token)
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    user: User | None = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    org_id = str(user.organization_id) if user.organization_id else None

    # SUPER_ADMIN can override org context via X-Org-Id header
    if user.role == UserRole.SUPER_ADMIN:
        org_header = request.headers.get("X-Org-Id")
        if org_header:
            org_id = org_header

    return {
        "id": str(user.id),
        "organization_id": org_id,
        "role": user.role.value if user.role else None,
        "email": user.email,
        "username": user.username,
        "name": user.display_name,
    }

# ─────────────────────────────────────────────────────────────────────────────
# RBAC dependency factory
# ─────────────────────────────────────────────────────────────────────────────
def require_roles(roles: list[str]):
    """FastAPI dependency: require caller to have one of the given roles."""
    def checker(user: dict = Depends(get_current_user)):
        if user.get("role") not in roles:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                detail=f"Required role: {roles}")
        return user
    return checker
