from sqlalchemy import func
from sqlalchemy.orm import Session
from uuid import UUID
from typing import Sequence

from app.models.test_run import TestRun, TestResult
from app.models.enums import ResultStatus


class TestRunRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, **kwargs) -> TestRun:
        obj = TestRun(**kwargs)
        self.db.add(obj)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def list(self, project_id: UUID) -> list[TestRun]:
        return (
            self.db.query(TestRun)
            .filter(TestRun.project_id == project_id)
            .order_by(TestRun.started_at.desc())
            .all()
        )

    def get(self, run_id: UUID) -> TestRun | None:
        return self.db.query(TestRun).filter(TestRun.id == run_id).first()

    def update(self, run_id: UUID, **changes) -> TestRun | None:
        obj = self.get(run_id)
        if not obj:
            return None
        for k, v in changes.items():
            setattr(obj, k, v)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def delete(self, run_id: UUID) -> bool:
        obj = self.get(run_id)
        if not obj:
            return False
        self.db.delete(obj)
        self.db.commit()
        return True


class TestResultRepository:
    def __init__(self, db: Session):
        self.db = db

    def _next_sequence(self, run_id: UUID) -> int:
        max_seq = (
            self.db.query(func.max(TestResult.sequence))
            .filter(TestResult.run_id == run_id)
            .scalar()
        )
        return (max_seq + 1) if max_seq is not None else 0

    def create(self, run_id: UUID, **kwargs) -> TestResult:
        kwargs.setdefault("sequence", self._next_sequence(run_id))
        obj = TestResult(run_id=run_id, **kwargs)
        self.db.add(obj)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def list_for_run(self, run_id: UUID) -> list[TestResult]:
        return (
            self.db.query(TestResult)
            .filter(TestResult.run_id == run_id)
            .order_by(TestResult.sequence.asc().nullslast(), TestResult.created_at.asc())
            .all()
        )

    def get(self, result_id: UUID) -> TestResult | None:
        return self.db.query(TestResult).filter(TestResult.id == result_id).first()

    def reorder(self, run_id: UUID, result_ids: Sequence[UUID]) -> None:
        # Порядок задаётся страницей прогона (drag/▲▼) и хранится в TestResult.sequence —
        # ровно та же схема, что testplan_cases.position для тест-плана.
        seq_by_id = {rid: i for i, rid in enumerate(result_ids)}
        rows = (
            self.db.query(TestResult)
            .filter(TestResult.run_id == run_id, TestResult.id.in_(result_ids))
            .all()
        )
        for row in rows:
            row.sequence = seq_by_id[row.id]
        self.db.commit()

    def bulk_create(self, run_id: UUID, case_ids: Sequence[UUID]) -> None:
        start = self._next_sequence(run_id)
        objs = [
            TestResult(run_id=run_id, test_case_id=cid, status=ResultStatus.untested, sequence=start + i)
            for i, cid in enumerate(case_ids)
        ]
        self.db.add_all(objs)
        self.db.commit()

    def update(self, result_id: UUID, **changes) -> TestResult | None:
        obj = self.get(result_id)
        if not obj:
            return None
        for k, v in changes.items():
            setattr(obj, k, v)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def delete_by_id(self, result_id: UUID) -> bool:
        obj = self.get(result_id)
        if not obj:
            return False
        self.db.delete(obj)
        self.db.commit()
        return True
