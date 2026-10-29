from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from uuid import UUID
from typing import Optional
from pydantic import BaseModel
from datetime import datetime

from app.core.dependencies import get_current_user
from app.db.session import get_db

from app.modules.testruns.repository import TestRunRepository, TestResultRepository
from app.modules.testruns.service import TestRunService, enrich_run_with_user
from app.modules.testruns.schemas import (
    TestRunCreate,
    TestRunUpdate,
    TestRunResponse,
    TestRunStats,
    TestResultCreate,
    TestResultUpdate,
    TestResultResponse,
    SetRunCasesRequest,
    ReorderResultsRequest,
)

router = APIRouter(prefix="/testruns", tags=["TestRuns"])


def get_service(db: Session = Depends(get_db)) -> TestRunService:
    return TestRunService(TestRunRepository(db), TestResultRepository(db))


# ── Dashboard schemas (defined early to avoid NameError) ─────────────────────

class DashboardStats(BaseModel):
    total: int; passed: int; failed: int
    blocked: int; skipped: int; untested: int

class FailingTest(BaseModel):
    case_id: UUID; case_name: str
    suite_id: Optional[UUID]; suite_name: Optional[str]
    run_id: UUID; run_name: str; executed_at: Optional[datetime]

class LatestRunInfo(BaseModel):
    id: UUID; name: str
    started_by_name: Optional[str]; started_at: datetime
    status: str; stats: DashboardStats

class DashboardData(BaseModel):
    execution_summary: DashboardStats
    failing_tests: list[FailingTest]
    latest_run: Optional[LatestRunInfo]


# ── Runs ──

@router.post("", response_model=TestRunResponse, status_code=201)
def create_run(
    data: TestRunCreate,
    db: Session = Depends(get_db),
    service: TestRunService = Depends(get_service),
    user=Depends(get_current_user),
):
    run = service.create(db, data, started_by=user["id"])
    return enrich_run_with_user(db, run)


@router.get("/dashboard", response_model=DashboardData)
def get_dashboard_inline(project_id: UUID, db: Session = Depends(get_db)):
    return _get_dashboard(project_id, db)


@router.get("", response_model=list[TestRunResponse])
def list_runs(
    project_id: UUID,
    test_plan_id: UUID | None = None,
    db: Session = Depends(get_db),
    service: TestRunService = Depends(get_service),
):
    runs = service.list(project_id)
    if test_plan_id is not None:
        runs = [r for r in runs if r.test_plan_id == test_plan_id]
    return [enrich_run_with_user(db, r) for r in runs]


@router.get("/{run_id}", response_model=TestRunResponse)
def get_run(
    run_id: UUID,
    db: Session = Depends(get_db),
    service: TestRunService = Depends(get_service),
):
    obj = service.get(run_id)
    if not obj:
        raise HTTPException(404, "TestRun not found")
    return enrich_run_with_user(db, obj)


@router.get("/{run_id}/stats", response_model=TestRunStats)
def get_run_stats(
    run_id: UUID,
    db: Session = Depends(get_db),
    service: TestRunService = Depends(get_service),
):
    stats = service.stats(db, run_id)
    if not stats:
        raise HTTPException(404, "TestRun not found")
    return stats


@router.patch("/{run_id}", response_model=TestRunResponse)
def update_run(
    run_id: UUID,
    data: TestRunUpdate,
    db: Session = Depends(get_db),
    service: TestRunService = Depends(get_service),
):
    obj = service.update(run_id, data)
    if not obj:
        raise HTTPException(404, "TestRun not found")
    return enrich_run_with_user(db, obj)


@router.post("/{run_id}/start", response_model=TestRunResponse)
def start_run(
    run_id: UUID,
    db: Session = Depends(get_db),
    service: TestRunService = Depends(get_service),
):
    obj = service.start(run_id)
    if not obj:
        raise HTTPException(404, "TestRun not found")
    return enrich_run_with_user(db, obj)


class HoldRequest(BaseModel):
    reason: str = ""


@router.post("/{run_id}/hold", response_model=TestRunResponse)
def hold_run(
    run_id: UUID,
    data: HoldRequest,
    db: Session = Depends(get_db),
    service: TestRunService = Depends(get_service),
):
    obj = service.hold(run_id, data.reason)
    if not obj:
        raise HTTPException(404, "TestRun not found")
    return enrich_run_with_user(db, obj)


@router.post("/{run_id}/resume", response_model=TestRunResponse)
def resume_run(
    run_id: UUID,
    db: Session = Depends(get_db),
    service: TestRunService = Depends(get_service),
):
    obj = service.resume(run_id)
    if not obj:
        raise HTTPException(404, "TestRun not found")
    return enrich_run_with_user(db, obj)


@router.post("/{run_id}/complete", response_model=TestRunResponse)
def complete_run(
    run_id: UUID,
    db: Session = Depends(get_db),
    service: TestRunService = Depends(get_service),
):
    obj = service.complete(run_id)
    if not obj:
        raise HTTPException(404, "TestRun not found")
    return enrich_run_with_user(db, obj)


@router.delete("/{run_id}", status_code=204)
def delete_run(run_id: UUID, service: TestRunService = Depends(get_service)):
    if not service.delete(run_id):
        raise HTTPException(404, "TestRun not found")


@router.put("/{run_id}/cases", status_code=204)
def set_run_cases(
    run_id: UUID,
    data: SetRunCasesRequest,
    service: TestRunService = Depends(get_service),
):
    if not service.get(run_id):
        raise HTTPException(404, "TestRun not found")
    service.set_cases(run_id, data.case_ids)


# ── Results ──

@router.post("/{run_id}/results", response_model=TestResultResponse, status_code=201)
def add_result(run_id: UUID, data: TestResultCreate, service: TestRunService = Depends(get_service)):
    if not service.get(run_id):
        raise HTTPException(404, "TestRun not found")
    return service.add_result(run_id, data)


@router.get("/{run_id}/results", response_model=list[TestResultResponse])
def list_results(run_id: UUID, service: TestRunService = Depends(get_service)):
    if not service.get(run_id):
        raise HTTPException(404, "TestRun not found")
    return service.list_results(run_id)


@router.post("/{run_id}/results/reorder", status_code=204)
def reorder_results(
    run_id: UUID,
    data: ReorderResultsRequest,
    service: TestRunService = Depends(get_service),
):
    if not service.get(run_id):
        raise HTTPException(404, "TestRun not found")
    service.reorder_results(run_id, data.result_ids)


@router.patch("/results/{result_id}", response_model=TestResultResponse)
def update_result(result_id: UUID, data: TestResultUpdate, service: TestRunService = Depends(get_service)):
    obj = service.update_result(result_id, data)
    if not obj:
        raise HTTPException(404, "TestResult not found")
    return obj


# ── Dashboard ─────────────────────────────────────────────────────────────────

def _get_dashboard(project_id: UUID, db: Session):
    from app.models.test_run import TestRun, TestResult
    from app.models.test_case import TestCase
    from app.models.test_suite import TestSuite
    from app.models.user import User
    from app.models.enums import ResultStatus

    runs = (
        db.query(TestRun)
        .filter(TestRun.project_id == project_id)
        .order_by(TestRun.started_at.desc())
        .all()
    )

    if not runs:
        empty = DashboardStats(total=0, passed=0, failed=0, blocked=0, skipped=0, untested=0)
        return DashboardData(execution_summary=empty, failing_tests=[], latest_run=None)

    run_ids = [r.id for r in runs]
    all_results = (
        db.query(TestResult)
        .filter(TestResult.run_id.in_(run_ids))
        .all()
    )

    # Latest result per case (last wins)
    latest: dict = {}
    for r in sorted(all_results, key=lambda x: (x.created_at or datetime.min)):
        latest[str(r.test_case_id)] = r

    # Summary across latest results
    counts = {"passed": 0, "failed": 0, "blocked": 0, "skipped": 0, "untested": 0}
    for r in latest.values():
        s = r.status.value
        if s in counts:
            counts[s] += 1
        else:
            counts["untested"] += 1

    summary = DashboardStats(
        total=len(latest), passed=counts["passed"], failed=counts["failed"],
        blocked=counts["blocked"], skipped=counts["skipped"], untested=counts["untested"],
    )

    # Failing tests
    cases_map = {str(c.id): c for c in db.query(TestCase).filter(TestCase.project_id == project_id).all()}
    suites_map = {str(s.id): s for s in db.query(TestSuite).filter(TestSuite.project_id == project_id).all()}
    runs_map = {str(r.id): r for r in runs}

    failing = []
    for r in latest.values():
        if r.status.value in ("failed", "blocked"):
            tc = cases_map.get(str(r.test_case_id))
            if not tc:
                continue
            suite = suites_map.get(str(tc.test_suite_id)) if tc.test_suite_id else None
            run = runs_map.get(str(r.run_id))
            if run:
                failing.append(FailingTest(
                    case_id=tc.id, case_name=tc.name,
                    suite_id=tc.test_suite_id, suite_name=suite.name if suite else None,
                    run_id=run.id, run_name=run.name, executed_at=r.executed_at,
                ))

    # Latest run stats
    latest_run_obj = runs[0] if runs else None
    latest_run_info = None
    if latest_run_obj:
        run_results = [r for r in all_results if r.run_id == latest_run_obj.id]
        rc = {"passed": 0, "failed": 0, "blocked": 0, "skipped": 0, "untested": 0}
        for r in run_results:
            s = r.status.value
            rc[s] = rc.get(s, 0) + 1
        run_stats = DashboardStats(
            total=len(run_results), passed=rc["passed"], failed=rc["failed"],
            blocked=rc["blocked"], skipped=rc.get("skipped", 0), untested=rc.get("untested", 0),
        )
        user = db.query(User).filter(User.id == latest_run_obj.started_by).first() if latest_run_obj.started_by else None
        latest_run_info = LatestRunInfo(
            id=latest_run_obj.id, name=latest_run_obj.name,
            started_by_name=user.name if user else None,
            started_at=latest_run_obj.started_at,
            status=latest_run_obj.status.value, stats=run_stats,
        )

    return DashboardData(
        execution_summary=summary,
        failing_tests=failing[:50],
        latest_run=latest_run_info,
    )
