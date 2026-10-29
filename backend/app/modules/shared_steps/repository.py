from __future__ import annotations
from typing import List, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.shared_step import SharedStep, SharedStepFolder


class SharedStepFolderRepository:
    def __init__(self, db: Session):
        self.db = db

    def list(self, project_id: UUID) -> List[SharedStepFolder]:
        return self.db.query(SharedStepFolder).filter(SharedStepFolder.project_id == project_id).all()

    def get(self, folder_id: UUID) -> Optional[SharedStepFolder]:
        return self.db.query(SharedStepFolder).filter(SharedStepFolder.id == folder_id).first()

    def create(self, project_id: UUID, name: str) -> SharedStepFolder:
        folder = SharedStepFolder(project_id=project_id, name=name)
        self.db.add(folder)
        self.db.commit()
        self.db.refresh(folder)
        return folder

    def update(self, folder_id: UUID, name: str) -> Optional[SharedStepFolder]:
        folder = self.get(folder_id)
        if not folder:
            return None
        folder.name = name
        self.db.commit()
        self.db.refresh(folder)
        return folder

    def delete(self, folder_id: UUID) -> bool:
        folder = self.get(folder_id)
        if not folder:
            return False
        self.db.delete(folder)
        self.db.commit()
        return True


class SharedStepRepository:
    def __init__(self, db: Session):
        self.db = db

    def list(self, project_id: UUID) -> List[SharedStep]:
        return self.db.query(SharedStep).filter(SharedStep.project_id == project_id).all()

    def get(self, step_id: UUID) -> Optional[SharedStep]:
        return self.db.query(SharedStep).filter(SharedStep.id == step_id).first()

    def create(self, data: dict) -> SharedStep:
        step = SharedStep(**data)
        self.db.add(step)
        self.db.commit()
        self.db.refresh(step)
        return step

    def update(self, step_id: UUID, data: dict) -> Optional[SharedStep]:
        step = self.get(step_id)
        if not step:
            return None
        for k, v in data.items():
            setattr(step, k, v)
        self.db.commit()
        self.db.refresh(step)
        return step

    def delete(self, step_id: UUID) -> bool:
        step = self.get(step_id)
        if not step:
            return False
        self.db.delete(step)
        self.db.commit()
        return True
