from __future__ import annotations

from sqlalchemy.orm import Session
from uuid import UUID

from app.models.checklist import Checklist, TestRunChecklist


class ChecklistRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, **kwargs) -> Checklist:
        obj = Checklist(**kwargs)
        self.db.add(obj)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def list(self, project_id: UUID) -> list[Checklist]:
        return (
            self.db.query(Checklist)
            .filter(Checklist.project_id == project_id)
            .order_by(Checklist.created_at.desc())
            .all()
        )

    def get(self, checklist_id: UUID) -> Checklist | None:
        return self.db.query(Checklist).filter(Checklist.id == checklist_id).first()

    def update(self, checklist_id: UUID, **changes) -> Checklist | None:
        obj = self.get(checklist_id)
        if not obj:
            return None
        for k, v in changes.items():
            setattr(obj, k, v)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def delete(self, checklist_id: UUID) -> bool:
        obj = self.get(checklist_id)
        if not obj:
            return False
        self.db.delete(obj)
        self.db.commit()
        return True

    # ── Привязка к прогонам ──

    def list_for_run(self, run_id: UUID) -> list[TestRunChecklist]:
        return (
            self.db.query(TestRunChecklist)
            .filter(TestRunChecklist.run_id == run_id)
            .all()
        )

    def get_run_checklist(self, run_id: UUID, checklist_id: UUID) -> TestRunChecklist | None:
        return (
            self.db.query(TestRunChecklist)
            .filter(TestRunChecklist.run_id == run_id, TestRunChecklist.checklist_id == checklist_id)
            .first()
        )

    def attach_to_run(self, run_id: UUID, checklist_id: UUID) -> TestRunChecklist:
        existing = self.get_run_checklist(run_id, checklist_id)
        if existing:
            return existing
        obj = TestRunChecklist(run_id=run_id, checklist_id=checklist_id, checked_items=[])
        self.db.add(obj)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def update_checked_items(self, run_id: UUID, checklist_id: UUID, checked_items: list[str]) -> TestRunChecklist | None:
        obj = self.get_run_checklist(run_id, checklist_id)
        if not obj:
            return None
        obj.checked_items = checked_items
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def detach_from_run(self, run_id: UUID, checklist_id: UUID) -> bool:
        obj = self.get_run_checklist(run_id, checklist_id)
        if not obj:
            return False
        self.db.delete(obj)
        self.db.commit()
        return True
