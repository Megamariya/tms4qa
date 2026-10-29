"""Одноразовый перенос вложений в MinIO и приведение ссылок к единому формату.

Обрабатывает test_results.attachments, defects.attachments, test_cases.steps[].attachments:
- base64 (data-URL) → файл в MinIO + относительная ссылка `/api/v1/attachments/{id}/file/{name}`;
- абсолютные ссылки старых версий прямо на бакет (`http://localhost:9000/tms-attachments/...`)
  → та же относительная ссылка (открывается с любого хоста, файл отдаёт бэкенд).
Идемпотентен: уже перенесённые ссылки не трогает — можно запускать повторно.

`--link-defect-files` — дополнительно привязать к дефектам с пустым `attachments` файлы, которые
лежат в MinIO с entity_type=defect (их загружали через API, а ссылки нигде не сохранялись).
Только для первого запуска после обновления: позже пустой список может означать, что
пользователь сам удалил вложения.

    docker compose exec backend python -m app.scripts.migrate_attachments_to_minio [--dry-run] [--link-defect-files]
"""
from __future__ import annotations

import sys

from sqlalchemy import String, cast, or_

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.attachment import Attachment
from app.models.defect import Defect
from app.models.test_case import TestCase
from app.models.test_run import TestResult, TestRun
from app.modules.attachments.storage import externalize, file_url, has_data_urls, relink_legacy, remove_objects


def _rows(db, model, column):
    text = cast(column, String)
    return db.query(model).filter(or_(text.like("%data:%"), text.like(f"%/{settings.MINIO_BUCKET}/%")))


def link_defect_files(db, dry_run: bool) -> int:
    linked = 0
    rows = (
        db.query(Attachment)
        .filter(Attachment.entity_type == "defect")
        .order_by(Attachment.created_at)
        .all()
    )
    by_defect: dict[str, list[Attachment]] = {}
    for att in rows:
        by_defect.setdefault(att.entity_id, []).append(att)
    for defect in db.query(Defect).filter(cast(Defect.id, String).in_(list(by_defect))).all():
        if defect.attachments:
            continue
        linked += 1
        if not dry_run:
            defect.attachments = [file_url(a) for a in by_defect[str(defect.id)]]
    if not dry_run:
        db.commit()
    return linked


def main(dry_run: bool = False, link_defects: bool = False) -> None:
    db = SessionLocal()
    stats = {"test_results": 0, "defects": 0, "test_cases": 0}
    try:
        jobs = [
            ("test_results", TestResult, TestResult.attachments, "attachments", "test_result",
             lambda r: db.get(TestRun, r.run_id).project_id),
            ("defects", Defect, Defect.attachments, "attachments", "defect", lambda d: d.project_id),
            ("test_cases", TestCase, TestCase.steps, "steps", "test_case", lambda c: c.project_id),
        ]
        for name, model, column, attr, entity_type, project_of in jobs:
            for obj in _rows(db, model, column).all():
                value = getattr(obj, attr)
                new_value = relink_legacy(db, value)
                if new_value == value and not has_data_urls(value):
                    continue
                stats[name] += 1
                if dry_run:
                    continue
                uploaded: list[str] = []
                try:
                    if has_data_urls(new_value):
                        new_value = externalize(db, new_value, project_of(obj), entity_type, obj.id, uploaded)
                    setattr(obj, attr, new_value)
                    db.commit()  # по одной записи — сбой не откатывает уже перенесённое
                except Exception:
                    db.rollback()
                    remove_objects(uploaded)
                    raise
        if link_defects:
            stats["defects_linked_files"] = link_defect_files(db, dry_run)
        print(("[dry-run] найдено" if dry_run else "обработано") + f": {stats}")
    finally:
        db.close()


if __name__ == "__main__":
    main(dry_run="--dry-run" in sys.argv, link_defects="--link-defect-files" in sys.argv)
