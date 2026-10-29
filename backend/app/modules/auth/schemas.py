from pydantic import BaseModel, EmailStr
from uuid import UUID
from typing import Optional


class LoginRequest(BaseModel):
    login: str        # email OR username
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class UserAuthOut(BaseModel):
    id: UUID
    email: str
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    name: Optional[str] = None
    role: Optional[str] = None
    organization_id: Optional[UUID] = None
    is_active: bool = True

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int       # seconds
    user: UserAuthOut
