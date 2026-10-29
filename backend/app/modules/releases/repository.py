from sqlalchemy.orm import Session
from uuid import UUID
from app.models.release import Release


class ReleaseRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, **kwargs) -> Release:
        obj = Release(**kwargs)
        self.db.add(obj)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def list(self, project_id: UUID) -> list[Release]:
        return (
            self.db.query(Release)
            .filter(Release.project_id == project_id)
            .order_by(Release.created_at.desc())
            .all()
        )

    def get(self, release_id: UUID) -> Release | None:
        return self.db.query(Release).filter(Release.id == release_id).first()

    def update(self, release_id: UUID, **changes) -> Release | None:
        obj = self.get(release_id)
        if not obj:
            return None
        for k, v in changes.items():
            setattr(obj, k, v)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def delete(self, release_id: UUID) -> bool:
        obj = self.get(release_id)
        if not obj:
            return False
        self.db.delete(obj)
        self.db.commit()
        return True
