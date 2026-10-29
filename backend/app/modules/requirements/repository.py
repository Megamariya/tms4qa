from __future__ import annotations

from sqlalchemy.orm import Session
from uuid import UUID

from app.models.requirement import Requirement
from app.models.test_case import TestCase


class RequirementRepository:
    def __init__(self, db: Session):
        self.db = db

    def _next_seq(self, project_id: UUID) -> int:
        last = (
            self.db.query(Requirement)
            .filter(Requirement.project_id == project_id)
            .order_by(Requirement.display_seq.desc().nullslast())
            .first()
        )
        return (last.display_seq or 0) + 1 if last else 1

    def create(self, **kwargs) -> Requirement:
        project_id = kwargs.get("project_id")
        kwargs.setdefault("display_seq", self._next_seq(project_id))
        obj = Requirement(**kwargs)
        self.db.add(obj)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def list(self, project_id: UUID) -> list[Requirement]:
        return (
            self.db.query(Requirement)
            .filter(Requirement.project_id == project_id)
            .order_by(Requirement.display_seq.asc().nullslast())
            .all()
        )

    def get(self, req_id: UUID) -> Requirement | None:
        return self.db.query(Requirement).filter(Requirement.id == req_id).first()

    def update(self, req_id: UUID, **changes) -> Requirement | None:
        obj = self.get(req_id)
        if not obj:
            return None
        for k, v in changes.items():
            setattr(obj, k, v)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def delete(self, req_id: UUID) -> bool:
        obj = self.get(req_id)
        if not obj:
            return False
        self.db.delete(obj)
        self.db.commit()
        return True

    def get_testcases(self, req_id: UUID) -> list[TestCase]:
        obj = self.get(req_id)
        if not obj:
            return []
        return obj.test_cases

    def set_testcases(self, req_id: UUID, case_ids: list[UUID]) -> Requirement | None:
        obj = self.get(req_id)
        if not obj:
            return None
        cases = self.db.query(TestCase).filter(TestCase.id.in_(case_ids)).all()
        obj.test_cases = cases
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def link_testcase(self, req_id: UUID, case_id: UUID) -> bool:
        obj = self.get(req_id)
        case = self.db.query(TestCase).filter(TestCase.id == case_id).first()
        if not obj or not case:
            return False
        if case not in obj.test_cases:
            obj.test_cases.append(case)
            self.db.commit()
        return True

    def unlink_testcase(self, req_id: UUID, case_id: UUID) -> bool:
        obj = self.get(req_id)
        case = self.db.query(TestCase).filter(TestCase.id == case_id).first()
        if not obj or not case:
            return False
        if case in obj.test_cases:
            obj.test_cases.remove(case)
            self.db.commit()
        return True
