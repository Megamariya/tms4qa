from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from uuid import UUID

from app.models.defect import Defect, defect_results
from app.models.test_run import TestResult


class DefectRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, **kwargs) -> Defect:
        project_id = kwargs.get("project_id")
        max_seq = (
            self.db.query(func.max(Defect.display_seq))
            .filter(Defect.project_id == project_id)
            .scalar()
        ) or 0
        obj = Defect(display_seq=max_seq + 1, **kwargs)
        self.db.add(obj)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def list(self, project_id: UUID, status: str | None = None, test_run_id: str | None = None) -> list[Defect]:
        q = self.db.query(Defect).filter(Defect.project_id == project_id)
        if status:
            q = q.filter(Defect.status == status)
        if test_run_id == "none":
            q = q.filter(Defect.test_run_id.is_(None))
        elif test_run_id:
            # Прямая привязка ИЛИ через результаты прогона (defect_results)
            linked = (
                select(defect_results.c.defect_id)
                .join(TestResult, TestResult.id == defect_results.c.result_id)
                .where(TestResult.run_id == UUID(test_run_id))
            )
            q = q.filter(or_(Defect.test_run_id == UUID(test_run_id), Defect.id.in_(linked)))
        return q.order_by(Defect.created_at.desc()).all()

    def get(self, defect_id: UUID) -> Defect | None:
        return self.db.query(Defect).filter(Defect.id == defect_id).first()

    def update(self, defect_id: UUID, **changes) -> Defect | None:
        obj = self.get(defect_id)
        if not obj:
            return None
        for k, v in changes.items():
            setattr(obj, k, v)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def delete(self, defect_id: UUID) -> bool:
        obj = self.get(defect_id)
        if not obj:
            return False
        self.db.delete(obj)
        self.db.commit()
        return True
