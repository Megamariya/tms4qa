from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from uuid import UUID
from typing import Optional
from pydantic import BaseModel

from app.db.session import get_db
from app.modules.requirements.repository import RequirementRepository
from app.modules.requirements.service import RequirementService
from app.modules.requirements.schemas import (
    RequirementCreate,
    RequirementUpdate,
    RequirementResponse,
    LinkCasesRequest,
)
from app.modules.testcases.schemas import TestCaseResponse

router = APIRouter(prefix="/requirements", tags=["Requirements"])


# ── Traceability schemas ──────────────────────────────────────────────────────

class DefectBrief(BaseModel):
    id: UUID
    display_seq: int
    title: str
    status: str
    severity: str

class CaseTrace(BaseModel):
    id: UUID
    name: str
    automation_status: str
    latest_status: str = "untested"
    suite_name: Optional[str] = None
    defects: list[DefectBrief] = []

class ReqTrace(BaseModel):
    id: UUID
    title: str
    req_type: Optional[str]
    status: Optional[str]
    priority: Optional[str]
    display_seq: Optional[int]
    parent_id: Optional[str] = None
    source: Optional[str] = None
    external_id: Optional[str] = None
    external_url: Optional[str] = None
    description: Optional[str] = None
    test_cases: list[CaseTrace]
    total_cases: int
    passed: int
    failed: int
    blocked: int
    untested: int
    coverage_pct: float
    last_run_date: Optional[str] = None


def get_service(db: Session = Depends(get_db)) -> RequirementService:
    return RequirementService(RequirementRepository(db))


@router.post("", response_model=RequirementResponse, status_code=201)
def create_requirement(data: RequirementCreate, service: RequirementService = Depends(get_service)):
    obj = service.create(data)
    obj.case_count = len(obj.test_cases)
    return obj


@router.get("", response_model=list[RequirementResponse])
def list_requirements(project_id: UUID, service: RequirementService = Depends(get_service)):
    return service.list(project_id)


# NOTE: /traceability must be declared BEFORE /{req_id} to avoid being matched as req_id
@router.get("/traceability", response_model=list[ReqTrace])
def traceability_inline(project_id: UUID, db: Session = Depends(get_db)):
    return _traceability(project_id, db)


@router.get("/{req_id}", response_model=RequirementResponse)
def get_requirement(req_id: UUID, service: RequirementService = Depends(get_service)):
    obj = service.get(req_id)
    if not obj:
        raise HTTPException(404, "Requirement not found")
    return obj


@router.patch("/{req_id}", response_model=RequirementResponse)
def update_requirement(req_id: UUID, data: RequirementUpdate, service: RequirementService = Depends(get_service)):
    obj = service.update(req_id, data)
    if not obj:
        raise HTTPException(404, "Requirement not found")
    obj.case_count = len(obj.test_cases)
    return obj


@router.delete("/{req_id}", status_code=204)
def delete_requirement(req_id: UUID, service: RequirementService = Depends(get_service)):
    if not service.delete(req_id):
        raise HTTPException(404, "Requirement not found")


@router.get("/{req_id}/testcases", response_model=list[TestCaseResponse])
def get_requirement_testcases(req_id: UUID, service: RequirementService = Depends(get_service)):
    obj = service.get(req_id)
    if not obj:
        raise HTTPException(404, "Requirement not found")
    return service.get_testcases(req_id)


@router.post("/{req_id}/testcases", status_code=204)
def set_requirement_testcases(req_id: UUID, data: LinkCasesRequest, service: RequirementService = Depends(get_service)):
    result = service.set_testcases(req_id, data.case_ids)
    if result is None:
        raise HTTPException(404, "Requirement not found")


@router.post("/{req_id}/testcases/{case_id}", status_code=204)
def link_testcase(req_id: UUID, case_id: UUID, service: RequirementService = Depends(get_service)):
    if not service.link_testcase(req_id, case_id):
        raise HTTPException(404, "Requirement or test case not found")


@router.delete("/{req_id}/testcases/{case_id}", status_code=204)
def unlink_testcase(req_id: UUID, case_id: UUID, service: RequirementService = Depends(get_service)):
    if not service.unlink_testcase(req_id, case_id):
        raise HTTPException(404, "Requirement or test case not found")


# ── Traceability ──────────────────────────────────────────────────────────────

def _traceability(project_id: UUID, db: Session):
    from app.models.requirement import Requirement
    from app.models.test_run import TestRun, TestResult
    from app.models.test_suite import TestSuite
    from app.models.defect import Defect

    reqs = (
        db.query(Requirement)
        .filter(Requirement.project_id == project_id)
        .order_by(Requirement.display_seq.asc().nullslast())
        .all()
    )

    # Latest result per test_case in this project (ordered asc so last wins)
    all_results = (
        db.query(TestResult)
        .join(TestRun, TestResult.run_id == TestRun.id)
        .filter(TestRun.project_id == project_id)
        .order_by(TestResult.executed_at.asc().nullslast(), TestResult.created_at.asc())
        .all()
    )
    latest_status: dict = {}
    result_by_case: dict = {}
    for r in all_results:
        latest_status[str(r.test_case_id)] = r.status.value
        result_by_case.setdefault(str(r.test_case_id), []).append(r)

    # Suite names
    suites = {str(s.id): s.name for s in db.query(TestSuite).filter(TestSuite.project_id == project_id).all()}

    out = []
    for req in reqs:
        cases_out = []
        passed = failed = blocked = untested = 0

        for tc in req.test_cases:
            cid = str(tc.id)
            status = latest_status.get(cid, "untested")

            # Defects linked to any result of this case
            results_for_case = result_by_case.get(cid, [])
            defect_set: dict = {}
            for res in results_for_case:
                for d in res.defects:
                    defect_set[str(d.id)] = DefectBrief(
                        id=d.id, display_seq=d.display_seq,
                        title=d.title, status=d.status.value, severity=d.severity.value,
                    )

            if status == "passed":   passed += 1
            elif status == "failed": failed += 1
            elif status == "blocked": blocked += 1
            else:                    untested += 1

            cases_out.append(CaseTrace(
                id=tc.id, name=tc.name,
                automation_status=tc.automation_status.value if hasattr(tc.automation_status, "value") else str(tc.automation_status),
                latest_status=status,
                suite_name=suites.get(str(tc.test_suite_id)) if tc.test_suite_id else None,
                defects=list(defect_set.values()),
            ))

        total = len(cases_out)
        coverage = round((passed / total) * 100, 1) if total > 0 else 0.0

        # Latest executed_at across all results for this requirement's test cases
        case_ids = {str(tc.id) for tc in req.test_cases}
        latest_date = None
        for cid in case_ids:
            for r in result_by_case.get(cid, []):
                if r.executed_at and (latest_date is None or r.executed_at > latest_date):
                    latest_date = r.executed_at
        last_run_date_str = latest_date.isoformat() if latest_date else None

        out.append(ReqTrace(
            id=req.id, title=req.title,
            req_type=req.req_type, status=req.status,
            priority=req.priority, display_seq=req.display_seq,
            parent_id=str(req.parent_id) if req.parent_id else None,
            source=req.source,
            external_id=req.external_id,
            external_url=req.external_url,
            description=req.description,
            test_cases=cases_out,
            total_cases=total, passed=passed, failed=failed,
            blocked=blocked, untested=untested, coverage_pct=coverage,
            last_run_date=last_run_date_str,
        ))

    return out
