from __future__ import annotations
from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.models.enums import ResultStatus, RunStatus
from app.models.test_case import TestCase
from app.models.test_plan import TestPlan
from app.models.test_run import TestResult
from app.models.user import User
from app.modules.attachments.storage import externalize, has_data_urls
from app.modules.testruns.repository import TestResultRepository, TestRunRepository
from app.modules.testruns.schemas import (
    TestResultCreate,
    TestResultUpdate,
    TestRunCreate,
    TestRunStats,
    TestRunUpdate,
)


class TestRunService:
    def __init__(self, run_repo: TestRunRepository, result_repo: TestResultRepository):
        self.runs = run_repo
        self.results = result_repo

    # ── Runs ──

    def create(self, db: Session, data: TestRunCreate, started_by: str | None = None) -> "TestRun":
        payload = data.model_dump(exclude={"test_case_ids"})
        if started_by:
            payload["started_by"] = UUID(started_by)
        run = self.runs.create(**payload)

        # Определяем какие кейсы войдут в этот прогон:
        # 1) явно переданные test_case_ids
        # 2) если указан test_plan_id — все кейсы привязанных suites плана
        # 3) иначе — все активные кейсы проекта
        case_ids = data.test_case_ids
        if not case_ids and run.test_plan_id:
            plan = db.query(TestPlan).filter(TestPlan.id == run.test_plan_id).first()
            if plan:
                if plan.test_cases:
                    case_ids = [c.id for c in plan.test_cases if not c.is_deleted]
                else:
                    suite_ids = [s.id for s in plan.suites]
                    if suite_ids:
                        case_ids = [
                            c.id
                            for c in db.query(TestCase)
                            .filter(
                                TestCase.project_id == plan.project_id,
                                TestCase.test_suite_id.in_(suite_ids),
                                TestCase.is_deleted.is_(False),
                            )
                            .all()
                        ]
        if not case_ids:
            case_ids = [
                c.id
                for c in db.query(TestCase)
                .filter(
                    TestCase.project_id == run.project_id,
                    TestCase.is_deleted.is_(False),
                )
                .all()
            ]

        # Создаём результаты одним bulk-insert
        if case_ids:
            self.results.bulk_create(run.id, case_ids)
        db.refresh(run)
        return run

    def list(self, project_id: UUID):
        return self.runs.list(project_id)

    def get(self, run_id: UUID):
        return self.runs.get(run_id)

    def update(self, run_id: UUID, data: TestRunUpdate):
        return self.runs.update(run_id, **data.model_dump(exclude_unset=True))

    def start(self, run_id: UUID):
        return self.runs.update(
            run_id,
            status=RunStatus.in_progress,
            started_at=datetime.now(timezone.utc),
        )

    def hold(self, run_id: UUID, reason: str | None = None):
        return self.runs.update(
            run_id,
            status=RunStatus.on_hold,
            hold_reason=reason or "",
        )

    def resume(self, run_id: UUID):
        return self.runs.update(
            run_id,
            status=RunStatus.in_progress,
            hold_reason=None,
        )

    def complete(self, run_id: UUID):
        return self.runs.update(
            run_id,
            status=RunStatus.completed,
            completed_at=datetime.now(timezone.utc),
        )

    def delete(self, run_id: UUID):
        return self.runs.delete(run_id)

    # ── Stats ──

    def stats(self, db: Session, run_id: UUID) -> TestRunStats | None:
        run = self.runs.get(run_id)
        if not run:
            return None
        results = self.results.list_for_run(run_id)
        counts = {
            "passed": 0,
            "failed": 0,
            "blocked": 0,
            "skipped": 0,
            "invalid": 0,
            "untested": 0,
        }
        for r in results:
            key = r.status.value if hasattr(r.status, "value") else str(r.status)
            if key in counts:
                counts[key] += 1
            else:
                counts["untested"] += 1
        return TestRunStats(total=len(results), **counts)

    # ── Results ──

    def _externalize_attachments(self, run_id: UUID, result_id, attachments):
        """base64 (старые клиенты / импорт бэкапов) → файлы в MinIO."""
        if not has_data_urls(attachments):
            return attachments
        run = self.runs.get(run_id)
        if not run:
            return attachments
        return externalize(self.results.db, attachments, run.project_id, "test_result", result_id)

    def add_result(self, run_id: UUID, data: TestResultCreate):
        executed_at = datetime.now(timezone.utc) if data.status != ResultStatus.untested else None
        payload = data.model_dump()
        if has_data_urls(payload.get("attachments")):
            payload["id"] = uuid4()
            payload["attachments"] = self._externalize_attachments(run_id, payload["id"], payload["attachments"])
        return self.results.create(
            run_id=run_id,
            executed_at=executed_at,
            **payload,
        )

    def list_results(self, run_id: UUID):
        return self.results.list_for_run(run_id)

    def update_result(self, result_id: UUID, data: TestResultUpdate):
        changes = data.model_dump(exclude_unset=True)
        if changes.get("status") and changes["status"] != ResultStatus.untested:
            changes["executed_at"] = datetime.now(timezone.utc)
        if has_data_urls(changes.get("attachments")):
            res = self.results.get(result_id)
            if not res:
                return None
            changes["attachments"] = self._externalize_attachments(res.run_id, result_id, changes["attachments"])
        return self.results.update(result_id, **changes)

    def reorder_results(self, run_id: UUID, result_ids: list[UUID]) -> None:
        self.results.reorder(run_id, result_ids)

    def set_cases(self, run_id: UUID, new_case_ids: list[UUID]) -> None:
        existing = self.results.list_for_run(run_id)
        existing_map = {r.test_case_id: r for r in existing}
        new_set = set(new_case_ids)
        existing_set = set(existing_map.keys())

        # Remove results for cases no longer selected
        for cid in existing_set - new_set:
            self.results.delete_by_id(existing_map[cid].id)

        # Add results for newly selected cases
        to_add = list(new_set - existing_set)
        if to_add:
            self.results.bulk_create(run_id, to_add)


# ── Helper: расширяем response started_by_name ──

def enrich_run_with_user(db: Session, run) -> dict:
    payload = {
        "id": run.id,
        "name": run.name,
        "description": run.description,
        "environment": run.environment,
        "configuration": run.configuration,
        "device_type": run.device_type,
        "os": run.os,
        "os_version": run.os_version,
        "project_id": run.project_id,
        "test_plan_id": run.test_plan_id,
        "release_id": run.release_id,
        "status": run.status,
        "hold_reason": run.hold_reason,
        "started_by": run.started_by,
        "started_by_name": None,
        "started_at": run.started_at,
        "completed_at": run.completed_at,
    }
    if run.started_by:
        u = db.query(User).filter(User.id == run.started_by).first()
        if u:
            payload["started_by_name"] = u.name
    return payload
