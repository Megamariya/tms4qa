"""Перенос тест-плана / тест-прогона между инсталляциями TMS4QA.

Экспорт собирает самодостаточный JSON-бандл: кроме самого плана/прогона в нём
лежат полные тест-кейсы с путём сьюта (`suite_path`), т.к. на другой машине
исходных UUID нет. При импорте сьюты ищутся/создаются по пути, кейсы — по
(сьют, название): существующий кейс переиспользуется, иначе создаётся новый.
Ссылки внутри бандла — по `ref` (UUID кейса в исходной системе).

Вложения (скриншоты/видео результатов, дефектов и шагов кейсов) хранятся в MinIO,
но в бандл кладутся inline как data-URL — формат остаётся v1, и бандл импортируется
и старыми версиями (они сохранят base64 как есть), и новыми (выгрузят файлы в свой MinIO).
Не переносятся: релизы, история аудита.
"""
from __future__ import annotations

import enum
from datetime import datetime, date, timezone
from typing import Any
from uuid import UUID, uuid4

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.checklist import Checklist, TestRunChecklist
from app.models.defect import Defect
from app.models.enums import (
    Severity, Priority, CaseStatus, CaseType, Behavior, Layer, AutomationStatus,
    PlanStatus, RunStatus, ResultStatus, DefectStatus,
)
from app.models.project import Project
from app.models.test_case import TestCase
from app.models.test_plan import TestPlan, testplan_cases
from app.models.test_run import TestRun, TestResult
from app.models.test_suite import TestSuite
from app.models.user import User
from app.modules.attachments.storage import externalize, has_data_urls, inline, remove_objects

FORMAT = "tms4qa-transfer"
VERSION = 1

CASE_FIELDS = (
    "name", "full_name", "description", "pre_conditions", "post_conditions", "steps",
    "severity", "priority", "status", "type", "behavior", "layer", "automation_status",
    "is_flaky", "muted", "framework", "tags", "labels", "revision",
)
CASE_ENUMS = {
    "severity": (Severity, Severity.normal),
    "priority": (Priority, Priority.not_set),
    "status": (CaseStatus, CaseStatus.actual),
    "type": (CaseType, CaseType.other),
    "behavior": (Behavior, Behavior.not_set),
    "layer": (Layer, Layer.not_set),
    "automation_status": (AutomationStatus, AutomationStatus.manual),
}
DEFECT_FIELDS = (
    "title", "impact", "steps_to_reproduce", "expected_result", "actual_result",
    "description", "environment", "tags", "pre_conditions", "external_id", "external_url",
    "severity", "priority", "status",
)
DEFECT_ENUMS = {
    "severity": (Severity, Severity.normal),
    "priority": (Priority, Priority.not_set),
    "status": (DefectStatus, DefectStatus.open),
}
RUN_FIELDS = (
    "name", "description", "status", "hold_reason", "environment", "configuration",
    "device_type", "os", "os_version",
)


# ── helpers ───────────────────────────────────────────────────────────────────

def _val(v: Any) -> Any:
    if isinstance(v, enum.Enum):
        return v.value
    if isinstance(v, (datetime, date)):
        return v.isoformat()
    if isinstance(v, UUID):
        return str(v)
    return v


def _enum(cls, raw, default):
    try:
        return cls(raw) if raw is not None else default
    except ValueError:
        return default


def _dt(raw: str | None) -> datetime | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw)
    except ValueError:
        return None


def _date(raw: str | None) -> date | None:
    if not raw:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None


def _suite_path(suite: TestSuite | None) -> list[str]:
    path: list[str] = []
    seen: set = set()
    while suite is not None and suite.id not in seen:
        seen.add(suite.id)
        path.insert(0, suite.name)
        suite = suite.parent
    return path


def _header(kind: str, project: Project | None) -> dict:
    return {
        "format": FORMAT,
        "version": VERSION,
        "kind": kind,
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "source_project": project.name if project else None,
    }


def _check_bundle(data: dict, kind: str) -> None:
    if not isinstance(data, dict) or data.get("format") != FORMAT:
        raise HTTPException(422, "Файл не является экспортом TMS4QA (format != tms4qa-transfer)")
    if data.get("kind") != kind:
        raise HTTPException(422, f"Ожидался экспорт '{kind}', получен '{data.get('kind')}'")
    if int(data.get("version") or 0) > VERSION:
        raise HTTPException(422, f"Версия формата {data.get('version')} новее поддерживаемой ({VERSION})")


def serialize_case(c: TestCase, db: Session | None = None) -> dict:
    d = {f: _val(getattr(c, f)) for f in CASE_FIELDS}
    if db is not None:
        d["steps"] = inline(db, d["steps"])  # картинки шагов из MinIO → data-URL
    d["ref"] = str(c.id)
    d["source_display_id"] = f"TC-{c.display_seq}" if c.display_seq else None
    d["suite_path"] = _suite_path(c.test_suite)
    return d


# ── import core ───────────────────────────────────────────────────────────────

class _Importer:
    def __init__(self, db: Session, project_id: UUID):
        self.db = db
        self.project_id = project_id
        self._suite_cache: dict[tuple, UUID | None] = {(): None}
        self._next_seq = (
            db.query(func.max(TestCase.display_seq)).filter(TestCase.project_id == project_id).scalar() or 0
        ) + 1
        self.stats = {"suites_created": 0, "cases_created": 0, "cases_reused": 0}
        # ключи загруженных в MinIO файлов — удаляются, если транзакция откатилась
        self.uploaded: list[str] = []

    def to_minio(self, value: Any, entity_type: str, entity_id) -> Any:
        if not has_data_urls(value):
            return value
        return externalize(self.db, value, self.project_id, entity_type, entity_id, self.uploaded)

    def suite_id(self, path: list[str]) -> UUID | None:
        key = tuple(p for p in (path or []) if p)
        if key in self._suite_cache:
            return self._suite_cache[key]
        parent_id = self.suite_id(list(key[:-1]))
        q = self.db.query(TestSuite).filter(TestSuite.project_id == self.project_id, TestSuite.name == key[-1])
        q = q.filter(TestSuite.parent_id.is_(None) if parent_id is None else TestSuite.parent_id == parent_id)
        suite = q.first()
        if not suite:
            suite = TestSuite(name=key[-1], project_id=self.project_id, parent_id=parent_id)
            self.db.add(suite)
            self.db.flush()
            self.stats["suites_created"] += 1
        self._suite_cache[key] = suite.id
        return suite.id

    def cases(self, items: list[dict], reuse_existing: bool) -> dict[str, TestCase]:
        by_ref: dict[str, TestCase] = {}
        for item in items or []:
            name = (item.get("name") or "").strip()
            if not name:
                continue
            sid = self.suite_id(item.get("suite_path") or [])
            existing = None
            if reuse_existing:
                q = self.db.query(TestCase).filter(
                    TestCase.project_id == self.project_id,
                    TestCase.name == name,
                    TestCase.is_deleted.is_(False),
                )
                q = q.filter(TestCase.test_suite_id.is_(None) if sid is None else TestCase.test_suite_id == sid)
                existing = q.first()
            if existing:
                self.stats["cases_reused"] += 1
                by_ref[item.get("ref") or name] = existing
                continue

            data = {f: item.get(f) for f in CASE_FIELDS if f in item}
            data["name"] = name
            for f, (cls, default) in CASE_ENUMS.items():
                data[f] = _enum(cls, data.get(f), default)
            data["steps"] = data.get("steps") or []
            data["tags"] = data.get("tags") or []
            data["labels"] = data.get("labels") or {}
            data["is_flaky"] = bool(data.get("is_flaky"))
            data["muted"] = bool(data.get("muted"))
            data["revision"] = data.get("revision") or 1
            order = (
                self.db.query(func.max(TestCase.display_order))
                .filter(TestCase.project_id == self.project_id,
                        TestCase.test_suite_id.is_(None) if sid is None else TestCase.test_suite_id == sid)
                .scalar() or 0
            ) + 1
            case_id = uuid4()
            data["steps"] = self.to_minio(data["steps"], "test_case", case_id)
            case = TestCase(
                id=case_id, project_id=self.project_id, test_suite_id=sid,
                display_seq=self._next_seq, display_order=order, **data,
            )
            self._next_seq += 1
            self.db.add(case)
            self.db.flush()
            self.stats["cases_created"] += 1
            by_ref[item.get("ref") or name] = case
        return by_ref

    def plan(self, plan_data: dict, case_order: list[str], suite_paths: list[list[str]],
             cases_by_ref: dict[str, TestCase]) -> TestPlan:
        max_seq = (
            self.db.query(func.max(TestPlan.display_seq)).filter(TestPlan.project_id == self.project_id).scalar() or 0
        )
        plan = TestPlan(
            project_id=self.project_id,
            display_seq=max_seq + 1,
            name=plan_data.get("name") or "Imported plan",
            description=plan_data.get("description"),
            references=plan_data.get("references"),
            status=_enum(PlanStatus, plan_data.get("status"), PlanStatus.active),
            start_date=_date(plan_data.get("start_date")),
            end_date=_date(plan_data.get("end_date")),
        )
        self.db.add(plan)
        self.db.flush()
        for path in suite_paths or []:
            sid = self.suite_id(path)
            if sid:
                suite = self.db.get(TestSuite, sid)
                if suite not in plan.suites:
                    plan.suites.append(suite)
        seen: set = set()
        rows = []
        for ref in case_order or []:
            case = cases_by_ref.get(ref)
            if case and case.id not in seen:
                seen.add(case.id)
                rows.append({"plan_id": plan.id, "case_id": case.id, "position": len(rows)})
        if rows:
            self.db.execute(testplan_cases.insert(), rows)
        self.db.flush()
        return plan


# ── Test plan ─────────────────────────────────────────────────────────────────

def _plan_body(plan: TestPlan) -> dict:
    cases = [c for c in plan.test_cases if not c.is_deleted]
    return {
        "plan": {
            "name": plan.name,
            "description": plan.description,
            "references": plan.references,
            "status": _val(plan.status),
            "start_date": _val(plan.start_date),
            "end_date": _val(plan.end_date),
            "source_display_id": plan.display_id,
        },
        "suite_paths": [_suite_path(s) for s in plan.suites],
        "case_order": [str(c.id) for c in cases],
    }, cases


def export_plan(db: Session, plan_id: UUID) -> dict:
    plan = db.get(TestPlan, plan_id)
    if not plan:
        raise HTTPException(404, "TestPlan not found")
    body, cases = _plan_body(plan)
    # План может быть собран только из сьютов (без явного списка кейсов)
    if not cases and plan.suites:
        sids = [s.id for s in plan.suites]
        cases = (
            db.query(TestCase)
            .filter(TestCase.test_suite_id.in_(sids), TestCase.is_deleted.is_(False))
            .order_by(TestCase.display_order, TestCase.display_seq)
            .all()
        )
    return {
        **_header("test_plan", db.get(Project, plan.project_id)),
        **body,
        "cases": [serialize_case(c, db) for c in cases],
    }


def import_plan(db: Session, project_id: UUID, data: dict, reuse_existing: bool = True) -> dict:
    _check_bundle(data, "test_plan")
    if not db.get(Project, project_id):
        raise HTTPException(404, "Project not found")
    imp = _Importer(db, project_id)
    try:
        cases = imp.cases(data.get("cases") or [], reuse_existing)
        plan = imp.plan(data.get("plan") or {}, data.get("case_order") or [], data.get("suite_paths") or [], cases)
        db.commit()
    except Exception:
        db.rollback()
        remove_objects(imp.uploaded)
        raise
    return {"plan_id": str(plan.id), "display_id": plan.display_id, **imp.stats}


# ── Test run ──────────────────────────────────────────────────────────────────

def export_run(db: Session, run_id: UUID, include_attachments: bool = True) -> dict:
    run = db.get(TestRun, run_id)
    if not run:
        raise HTTPException(404, "TestRun not found")
    results = (
        db.query(TestResult)
        .filter(TestResult.run_id == run_id)
        .order_by(TestResult.sequence.asc().nullslast(), TestResult.created_at.asc())
        .all()
    )
    cases: dict[UUID, TestCase] = {r.test_case_id: r.test_case for r in results if r.test_case}

    plan_block = None
    if run.plan:
        plan_block, plan_cases = _plan_body(run.plan)
        for c in plan_cases:
            cases.setdefault(c.id, c)

    result_ids = {r.id for r in results}
    defects = (
        db.query(Defect)
        .filter(Defect.project_id == run.project_id)
        .filter((Defect.test_run_id == run_id) | Defect.results.any(TestResult.run_id == run_id))
        .order_by(Defect.display_seq)
        .all()
    )
    links = db.query(TestRunChecklist).filter(TestRunChecklist.run_id == run_id).all()

    return {
        **_header("test_run", run.project),
        "run": {
            **{f: _val(getattr(run, f)) for f in RUN_FIELDS},
            "started_at": _val(run.started_at),
            "completed_at": _val(run.completed_at),
        },
        "plan": plan_block,
        "cases": [serialize_case(c, db) for c in cases.values()],
        "results": [
            {
                "case_ref": str(r.test_case_id),
                "sequence": r.sequence,
                "status": _val(r.status),
                "comment": r.comment,
                "actual_result": r.actual_result,
                "time_spent_ms": r.time_spent_ms or 0,
                "executed_at": _val(r.executed_at),
                "executor_email": r.executor.email if r.executor else None,
                # {step_index: [data-URL, ...]} — файлы из MinIO встраиваются inline
                "attachments": inline(db, r.attachments or {}) if include_attachments else {},
            }
            for r in results
        ],
        "defects": [
            {
                **{f: _val(getattr(d, f)) for f in DEFECT_FIELDS},
                "source_display_id": f"D-{d.display_seq}",
                "case_refs": [str(r.test_case_id) for r in d.results if r.id in result_ids],
                # старые версии ключ не знают и игнорируют
                "attachments": inline(db, d.attachments or []) if include_attachments else [],
            }
            for d in defects
        ],
        "checklists": [
            {"title": l.checklist.title, "items": l.checklist.items or [], "checked_items": l.checked_items or []}
            for l in links if l.checklist
        ],
    }


def import_run(db: Session, project_id: UUID, data: dict, started_by: str | None,
               reuse_existing: bool = True, include_plan: bool = True) -> dict:
    _check_bundle(data, "test_run")
    if not db.get(Project, project_id):
        raise HTTPException(404, "Project not found")
    imp = _Importer(db, project_id)
    try:
        cases = imp.cases(data.get("cases") or [], reuse_existing)

        plan = None
        pb = data.get("plan")
        if include_plan and pb:
            plan = imp.plan(pb.get("plan") or {}, pb.get("case_order") or [], pb.get("suite_paths") or [], cases)

        rd = data.get("run") or {}
        run = TestRun(
            project_id=project_id,
            test_plan_id=plan.id if plan else None,
            name=rd.get("name") or "Imported run",
            description=rd.get("description"),
            status=_enum(RunStatus, rd.get("status"), RunStatus.ready_to_start),
            hold_reason=rd.get("hold_reason"),
            environment=rd.get("environment"),
            configuration=rd.get("configuration"),
            device_type=rd.get("device_type"),
            os=rd.get("os"),
            os_version=rd.get("os_version"),
            started_by=UUID(started_by) if started_by else None,
            completed_at=_dt(rd.get("completed_at")),
        )
        if _dt(rd.get("started_at")):
            run.started_at = _dt(rd.get("started_at"))
        db.add(run)
        db.flush()

        emails = {r.get("executor_email") for r in data.get("results") or [] if r.get("executor_email")}
        users = {u.email: u.id for u in db.query(User).filter(User.email.in_(emails)).all()} if emails else {}

        results_by_case: dict[UUID, TestResult] = {}
        for i, r in enumerate(data.get("results") or []):
            case = cases.get(r.get("case_ref"))
            if not case or case.id in results_by_case:
                continue
            res_id = uuid4()
            res = TestResult(
                id=res_id,
                run_id=run.id,
                test_case_id=case.id,
                sequence=r.get("sequence") if r.get("sequence") is not None else i,
                status=_enum(ResultStatus, r.get("status"), ResultStatus.untested),
                comment=r.get("comment"),
                actual_result=r.get("actual_result"),
                time_spent_ms=r.get("time_spent_ms") or 0,
                executed_at=_dt(r.get("executed_at")),
                executor_id=users.get(r.get("executor_email")),
                attachments=imp.to_minio(r.get("attachments") or {}, "test_result", res_id),
            )
            db.add(res)
            results_by_case[case.id] = res
        db.flush()

        next_defect = (
            db.query(func.max(Defect.display_seq)).filter(Defect.project_id == project_id).scalar() or 0
        ) + 1
        defects_created = 0
        for d in data.get("defects") or []:
            if not d.get("title"):
                continue
            fields = {f: d.get(f) for f in DEFECT_FIELDS if f in d}
            for f, (cls, default) in DEFECT_ENUMS.items():
                fields[f] = _enum(cls, fields.get(f), default)
            fields["tags"] = fields.get("tags") or []
            defect_id = uuid4()
            attachments = d.get("attachments") if isinstance(d.get("attachments"), list) else []
            defect = Defect(
                id=defect_id, attachments=imp.to_minio(attachments, "defect", defect_id),
                project_id=project_id, test_run_id=run.id, display_seq=next_defect,
                reporter_id=UUID(started_by) if started_by else None, **fields,
            )
            next_defect += 1
            for ref in d.get("case_refs") or []:
                case = cases.get(ref)
                if case and case.id in results_by_case:
                    defect.results.append(results_by_case[case.id])
            db.add(defect)
            defects_created += 1

        checklists_added = 0
        for cl in data.get("checklists") or []:
            title = (cl.get("title") or "").strip()
            if not title:
                continue
            checklist = db.query(Checklist).filter(Checklist.project_id == project_id, Checklist.title == title).first()
            if not checklist:
                checklist = Checklist(project_id=project_id, title=title, items=cl.get("items") or [])
                db.add(checklist)
                db.flush()
            db.add(TestRunChecklist(run_id=run.id, checklist_id=checklist.id, checked_items=cl.get("checked_items") or []))
            checklists_added += 1

        db.commit()
    except Exception:
        db.rollback()
        remove_objects(imp.uploaded)
        raise
    return {
        "run_id": str(run.id),
        "plan_id": str(plan.id) if plan else None,
        "results_created": len(results_by_case),
        "defects_created": defects_created,
        "checklists_added": checklists_added,
        **imp.stats,
    }
