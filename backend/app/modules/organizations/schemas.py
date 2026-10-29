from pydantic import BaseModel
from uuid import UUID
from typing import Optional


class OrganizationCreate(BaseModel):
    name: str


class OrganizationOwnerUpdate(BaseModel):
    website_url: Optional[str] = None


class OrganizationOut(BaseModel):
    id: UUID
    name: str
    website_url: Optional[str] = None

    class Config:
        from_attributes = True