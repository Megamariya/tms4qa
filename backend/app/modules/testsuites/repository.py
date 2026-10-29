from sqlalchemy import text
from sqlalchemy.orm import Session
from uuid import UUID

from app.models.test_suite import TestSuite
from app.models.test_case import TestCase


class TestSuiteRepository:

    def __init__(self, db: Session):
        self.db = db

    def create(self, data: dict):
        obj = TestSuite(**data)
        self.db.add(obj)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def get(self, suite_id: UUID):
        return self.db.query(TestSuite).filter(TestSuite.id == suite_id).first()

    def list(self, project_id: UUID):
        return self.db.query(TestSuite).filter(
            TestSuite.project_id == project_id
        ).all()

    def update(self, obj: TestSuite, data: dict):
        for k, v in data.items():
            setattr(obj, k, v)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def delete(self, obj: TestSuite):
        self.db.delete(obj)
        self.db.commit()

    def delete_subtree(self, root_id: UUID, keep_cases: bool = False) -> bool:
        """Delete a suite and all its descendants.

        keep_cases=True  → move all cases to no suite (test_suite_id=NULL)
        keep_cases=False → delete all cases as well
        """
        rows = self.db.execute(text("""
            WITH RECURSIVE d AS (
                SELECT id FROM test_suites WHERE id = :root
                UNION ALL
                SELECT ts.id FROM test_suites ts JOIN d ON ts.parent_id = d.id
            )
            SELECT id FROM d
        """), {"root": root_id}).fetchall()

        if not rows:
            return False

        ids = [row[0] for row in rows]

        if keep_cases:
            self.db.query(TestCase).filter(TestCase.test_suite_id.in_(ids)).update(
                {"test_suite_id": None}, synchronize_session=False
            )
        else:
            # Collect case IDs before deleting FK-dependent records
            case_ids = [
                row[0] for row in self.db.execute(
                    text("SELECT id FROM test_cases WHERE test_suite_id = ANY(:ids)"),
                    {"ids": ids},
                ).fetchall()
            ]
            if case_ids:
                self.db.execute(
                    text("DELETE FROM test_results WHERE test_case_id = ANY(:ids)"),
                    {"ids": case_ids},
                )
                self.db.execute(
                    text("DELETE FROM requirement_testcases WHERE test_case_id = ANY(:ids)"),
                    {"ids": case_ids},
                )
                self.db.execute(
                    text("DELETE FROM testplan_cases WHERE case_id = ANY(:ids)"),
                    {"ids": case_ids},
                )
            self.db.query(TestCase).filter(TestCase.test_suite_id.in_(ids)).delete(
                synchronize_session=False
            )

        # Delete suites leaf-first (reversed BFS) to satisfy FK constraints
        for sid in reversed(ids):
            self.db.execute(text("DELETE FROM test_suites WHERE id = :id"), {"id": sid})

        self.db.commit()
        return True