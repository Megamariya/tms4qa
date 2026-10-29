from __future__ import annotations
from uuid import UUID
from typing import List

from sqlalchemy.orm import Session

from app.models.enums import AutomationStatus, ResultStatus
from app.models.test_case import TestCase
from app.models.test_run import TestResult, TestRun
from app.models.test_suite import TestSuite
from app.modules.testplans.repository import TestPlanRepository
from app.modules.testplans.schemas import TestPlanStats

# Fields we don't want cluttering the change history with noise.
_HISTORY_IGNORED_FIELDS = {"updated_at"}


def _jsonable(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return str(value)


class TestPlanService:
    def __init__(self, repo: TestPlanRepository):
        self.repo = repo

    def _log(self, actor_id: str | None, action: str, plan_id: UUID, details: dict | None):
        from app.models.audit_log import AuditLog
        self.repo.db.add(AuditLog(
            actor_id=actor_id,
            action=f"test_plan.{action}",
            entity_type="test_plan",
            entity_id=str(plan_id),
            details=details,
        ))
        self.repo.db.commit()

    def create(self, data, actor_id: str | None = None):
        plan = self.repo.create(data.model_dump())
        self._log(actor_id, "create", plan.id, {"name": plan.name})
        return plan

    def get(self, plan_id: UUID):
        return self.repo.get(plan_id)

    def list(self, project_id: UUID):
        return self.repo.list(project_id)

    def update(self, plan_id: UUID, data, actor_id: str | None = None):
        obj = self.repo.get(plan_id)
        if not obj:
            return None
        changes = data.model_dump(exclude_unset=True)
        before = {k: getattr(obj, k) for k in changes if k not in _HISTORY_IGNORED_FIELDS}
        updated = self.repo.update(obj, changes)
        diff = {
            k: {"old": _jsonable(old_val), "new": _jsonable(getattr(updated, k))}
            for k, old_val in before.items()
            if old_val != getattr(updated, k)
        }
        if diff:
            self._log(actor_id, "update", updated.id, diff)
        return updated

    def delete(self, plan_id: UUID, actor_id: str | None = None):
        obj = self.repo.get(plan_id)
        if not obj:
            return False
        name = obj.name
        self.repo.delete(obj)
        self._log(actor_id, "delete", plan_id, {"name": name})
        return True

    def history(self, db: Session, plan_id: UUID):
        from app.models.audit_log import AuditLog
        from app.models.user import User
        return (
            db.query(AuditLog, User.email, User.name)
            .outerjoin(User, User.id == AuditLog.actor_id)
            .filter(AuditLog.entity_type == "test_plan", AuditLog.entity_id == str(plan_id))
            .order_by(AuditLog.created_at.desc())
            .all()
        )

    def add_suite(self, plan_id: UUID, suite: TestSuite):
        plan = self.repo.get(plan_id)
        if not plan:
            return None
        return self.repo.add_suite(plan, suite)

    def remove_suite(self, plan_id: UUID, suite: TestSuite):
        plan = self.repo.get(plan_id)
        if not plan:
            return None
        return self.repo.remove_suite(plan, suite)

    def set_cases(self, db: Session, plan_id: UUID, case_ids: list[UUID]):
        plan = self.repo.get(plan_id)
        if not plan:
            return None
        from app.models.test_case import TestCase
        # `IN (...)` не гарантирует порядок строк — восстанавливаем его по case_ids,
        # чтобы порядок, заданный на странице плана, сохранился как есть.
        cases_by_id = (
            {c.id: c for c in db.query(TestCase).filter(TestCase.id.in_(case_ids)).all()}
            if case_ids else {}
        )
        ordered_cases = [cases_by_id[cid] for cid in case_ids if cid in cases_by_id]
        return self.repo.set_cases(plan, ordered_cases)

    # ── Stats для дашборда плана ──

    def stats(self, db: Session, plan_id: UUID) -> TestPlanStats | None:
        plan = self.repo.get(plan_id)
        if not plan:
            return None

        # Кейсы плана: уникальный набор case_id из всех suites плана
        if plan.test_cases:
            cases = [c for c in plan.test_cases if not c.is_deleted]
        else:
            suite_ids = [s.id for s in plan.suites]
            case_query = db.query(TestCase).filter(TestCase.project_id == plan.project_id)
            if suite_ids:
                case_query = case_query.filter(TestCase.test_suite_id.in_(suite_ids))
            cases = case_query.all()
        total_cases = len(cases)
        case_ids = [c.id for c in cases]
        is_auto = {
            c.id: c.automation_status == AutomationStatus.automated for c in cases
        }

        counters = {
            "passed": 0,
            "failed": 0,
            "blocked": 0,
            "skipped": 0,
            "automation_passed": 0,
            "automation_failed": 0,
            "automation_error": 0,
        }
        results_by_case: dict = {}

        if case_ids:
            # Берём последний результат на каждый case в любом run этого плана
            results = (
                db.query(TestResult)
                .join(TestRun, TestResult.run_id == TestRun.id)
                .filter(
                    TestRun.test_plan_id == plan_id,
                    TestResult.test_case_id.in_(case_ids),
                )
                .order_by(TestResult.created_at.desc())
                .all()
            )
            for r in results:
                if r.test_case_id in results_by_case:
                    continue
                results_by_case[r.test_case_id] = r

            for case_id, r in results_by_case.items():
                auto = is_auto.get(case_id, False)
                if r.status == ResultStatus.passed:
                    counters["automation_passed" if auto else "passed"] += 1
                elif r.status == ResultStatus.failed:
                    counters["automation_failed" if auto else "failed"] += 1
                elif r.status == ResultStatus.invalid and auto:
                    counters["automation_error"] += 1
                elif r.status == ResultStatus.blocked:
                    counters["blocked"] += 1
                elif r.status == ResultStatus.skipped:
                    counters["skipped"] += 1

        completed = sum(counters.values())
        untested = total_cases - completed
        passed_total = counters["passed"] + counters["automation_passed"]
        passed_rate = (passed_total / total_cases) if total_cases else 0
        completion_rate = (completed / total_cases) if total_cases else 0

        return TestPlanStats(
            total_cases=total_cases,
            untested=max(untested, 0),
            **counters,
            passed_rate=round(passed_rate, 4),
            completion_rate=round(completion_rate, 4),
        )
