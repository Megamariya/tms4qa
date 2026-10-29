from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from uuid import UUID
from typing import List

from app.db.session import get_db
from app.core.dependencies import get_current_user

from app.modules.testplans.schemas import (
    TestPlanCreate,
    TestPlanUpdate,
    TestPlanResponse,
    TestPlanStats,
    TestPlanHistoryEntry,
    AddSuiteRequest,
    SetCasesRequest,
)
from app.modules.testplans.repository import TestPlanRepository
from app.modules.testplans.service import TestPlanService
from app.modules.testsuites.repository import TestSuiteRepository
from app.modules.testcases.schemas import TestCaseResponse
from app.models.test_case import TestCase
from app.models.test_run import TestRun

router = APIRouter(prefix="/testplans", tags=["TestPlans"])


def get_service(db: Session = Depends(get_db)):
    return TestPlanService(TestPlanRepository(db))


def _enrich(plan, run_count: int = 0) -> dict:
    d = {c.name: getattr(plan, c.name) for c in plan.__table__.columns}
    d["display_id"] = plan.display_id
    d["case_count"] = plan.case_count
    d["run_count"] = run_count
    return d


@router.post("", response_model=TestPlanResponse, status_code=201)
def create(
    data: TestPlanCreate,
    db: Session = Depends(get_db),
    service: TestPlanService = Depends(get_service),
    user: dict = Depends(get_current_user),
):
    plan = service.create(data, actor_id=user["id"])
    return TestPlanResponse(**_enrich(plan))


@router.get("", response_model=List[TestPlanResponse])
def list_plans(project_id: UUID, db: Session = Depends(get_db), service: TestPlanService = Depends(get_service)):
    plans = service.list(project_id)
    plan_ids = [p.id for p in plans]
    run_counts = dict(
        db.query(TestRun.test_plan_id, func.count(TestRun.id))
        .filter(TestRun.test_plan_id.in_(plan_ids))
        .group_by(TestRun.test_plan_id)
        .all()
    ) if plan_ids else {}
    return [TestPlanResponse(**_enrich(p, run_counts.get(p.id, 0))) for p in plans]


@router.get("/{plan_id}", response_model=TestPlanResponse)
def get_plan(plan_id: UUID, db: Session = Depends(get_db), service: TestPlanService = Depends(get_service)):
    obj = service.get(plan_id)
    if not obj:
        raise HTTPException(404, "TestPlan not found")
    run_count = db.query(func.count(TestRun.id)).filter(TestRun.test_plan_id == plan_id).scalar() or 0
    return TestPlanResponse(**_enrich(obj, run_count))


@router.patch("/{plan_id}", response_model=TestPlanResponse)
def update_plan(
    plan_id: UUID,
    data: TestPlanUpdate,
    db: Session = Depends(get_db),
    service: TestPlanService = Depends(get_service),
    user: dict = Depends(get_current_user),
):
    obj = service.update(plan_id, data, actor_id=user["id"])
    if not obj:
        raise HTTPException(404, "TestPlan not found")
    run_count = db.query(func.count(TestRun.id)).filter(TestRun.test_plan_id == plan_id).scalar() or 0
    return TestPlanResponse(**_enrich(obj, run_count))


@router.delete("/{plan_id}", status_code=204)
def delete_plan(
    plan_id: UUID,
    db: Session = Depends(get_db),
    service: TestPlanService = Depends(get_service),
    user: dict = Depends(get_current_user),
):
    obj = service.get(plan_id)
    if not obj:
        raise HTTPException(404, "TestPlan not found")
    # Unlink any test runs that reference this plan before deleting
    db.query(TestRun).filter(TestRun.test_plan_id == plan_id).update(
        {"test_plan_id": None}, synchronize_session=False
    )
    db.commit()
    service.delete(plan_id, actor_id=user["id"])


@router.get("/{plan_id}/history", response_model=List[TestPlanHistoryEntry])
def get_history(
    plan_id: UUID,
    db: Session = Depends(get_db),
    service: TestPlanService = Depends(get_service),
):
    obj = service.get(plan_id)
    if not obj:
        raise HTTPException(404, "TestPlan not found")
    rows = service.history(db, plan_id)
    return [
        TestPlanHistoryEntry(
            id=log.id, action=log.action, actor_name=name, actor_email=email,
            details=log.details, created_at=log.created_at,
        )
        for log, email, name in rows
    ]


@router.get("/{plan_id}/cases", response_model=List[TestCaseResponse])
def list_plan_cases(plan_id: UUID, service: TestPlanService = Depends(get_service)):
    plan = service.get(plan_id)
    if not plan:
        raise HTTPException(404, "TestPlan not found")
    return [c for c in plan.test_cases if not c.is_deleted]


@router.post("/{plan_id}/cases/batch", status_code=204)
def set_plan_cases(
    plan_id: UUID,
    data: SetCasesRequest,
    db: Session = Depends(get_db),
    service: TestPlanService = Depends(get_service),
):
    plan = service.set_cases(db, plan_id, data.case_ids)
    if not plan:
        raise HTTPException(404, "TestPlan not found")


@router.get("/{plan_id}/stats", response_model=TestPlanStats)
def get_stats(
    plan_id: UUID,
    db: Session = Depends(get_db),
    service: TestPlanService = Depends(get_service),
):
    obj = service.stats(db, plan_id)
    if not obj:
        raise HTTPException(404, "TestPlan not found")
    return obj


@router.post("/{plan_id}/suites")
def add_suite(
    plan_id: UUID,
    data: AddSuiteRequest,
    db: Session = Depends(get_db),
    service: TestPlanService = Depends(get_service),
):
    suite = TestSuiteRepository(db).get(data.suite_id)
    if not suite:
        raise HTTPException(404, "TestSuite not found")
    plan = service.add_suite(plan_id, suite)
    if not plan:
        raise HTTPException(404, "TestPlan not found")
    return {"status": "ok"}


@router.delete("/{plan_id}/suites/{suite_id}")
def remove_suite(
    plan_id: UUID,
    suite_id: UUID,
    db: Session = Depends(get_db),
    service: TestPlanService = Depends(get_service),
):
    suite = TestSuiteRepository(db).get(suite_id)
    if not suite:
        raise HTTPException(404, "TestSuite not found")
    plan = service.remove_suite(plan_id, suite)
    if not plan:
        raise HTTPException(404, "TestPlan not found")
    return {"status": "ok"}
