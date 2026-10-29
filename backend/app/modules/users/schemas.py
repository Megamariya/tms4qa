from pydantic import BaseModel
from uuid import UUID
from typing import Optional


class UserCreate(BaseModel):
    email: str
    name: str

    class Config:
        json_schema_extra = {
            "example": {"email": "admin@tms.local", "name": "Admin User"}
        }


class UserResponse(BaseModel):
    id: UUID
    email: str
    name: Optional[str] = None

    class Config:
        from_attributes = True


class UserFullResponse(BaseModel):
    id: UUID
    email: str
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    name: Optional[str] = None
    role: Optional[str] = None
    organization_id: Optional[UUID] = None
    is_active: bool = True
    phone: Optional[str] = None
    telegram: Optional[str] = None

    class Config:
        from_attributes = True


class UserInvite(BaseModel):
    email: str
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    role: str = "TESTER"
    password: str


class UserRoleUpdate(BaseModel):
    role: str


class UserContactUpdate(BaseModel):
    email: Optional[str] = None
    phone: Optional[str] = None
    telegram: Optional[str] = None
