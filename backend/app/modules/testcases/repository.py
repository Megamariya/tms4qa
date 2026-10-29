from __future__ import annotations

from sqlalchemy.orm import Session
from sqlalchemy import func
from uuid import UUID

from app.models.test_case import TestCase


class TestCaseRepository:

    def __init__(self, db: Session):
        self.db = db

    def _next_display_seq(self, project_id) -> int:
        max_seq = self.db.query(func.max(TestCase.display_seq)).filter(
            TestCase.project_id == project_id
        ).scalar()
        return (max_seq or 0) + 1

    def _next_display_order(self, project_id, suite_id) -> int:
        query = self.db.query(func.max(TestCase.display_order)).filter(
            TestCase.project_id == project_id
        )
        if suite_id is None:
            query = query.filter(TestCase.test_suite_id.is_(None))
        else:
            query = query.filter(TestCase.test_suite_id == suite_id)
        max_order = query.scalar()
        return (max_order or 0) + 1

    def create(self, data: dict) -> TestCase:
        project_id = data.get("project_id")
        suite_id = data.get("test_suite_id")
        data["display_seq"] = self._next_display_seq(project_id)
        data["display_order"] = self._next_display_order(project_id, suite_id)
        obj = TestCase(**data)
        self.db.add(obj)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def get(self, test_case_id: UUID) -> TestCase | None:
        return self.db.query(TestCase).filter(TestCase.id == test_case_id).first()

    def list(self, project_id: UUID | None = None):
        query = self.db.query(TestCase)
        if project_id:
            query = query.filter(TestCase.project_id == project_id)
        query = query.order_by(TestCase.display_order.asc(), TestCase.display_seq.asc())
        return query.all()

    def update(self, obj: TestCase, data: dict) -> TestCase:
        for field, value in data.items():
            setattr(obj, field, value)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def delete(self, obj: TestCase):
        self.db.delete(obj)
        self.db.commit()

    def bulk_move_suite(self, case_ids: list, target_suite_id) -> int:
        from sqlalchemy import update
        result = self.db.execute(
            update(TestCase)
            .where(TestCase.id.in_(case_ids))
            .values(test_suite_id=target_suite_id)
        )
        self.db.commit()
        return result.rowcount

    def batch_reorder(self, ordered_ids: list[UUID]) -> None:
        """Обновить display_order для списка кейсов в указанном порядке."""
        for i, case_id in enumerate(ordered_ids):
            self.db.query(TestCase).filter(TestCase.id == case_id).update(
                {"display_order": i}, synchronize_session=False
            )
        self.db.commit()
