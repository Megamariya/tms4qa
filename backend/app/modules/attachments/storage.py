"""Хранение вложений (скриншоты, видео, файлы) в MinIO.

В JSONB-полях (test_results.attachments, defects.attachments, test_cases.steps[].attachments)
хранится ОТНОСИТЕЛЬНАЯ ссылка `/api/v1/attachments/{id}/file/{filename}` — она не зависит
от хоста, на котором открыт TMS, и от адреса MinIO.

- `externalize()` — заменяет data-URL (base64) на загруженный в MinIO файл. Вызывается на
  каждой записи, поэтому старые клиенты/бэкапы/бандлы с base64 тоже попадают в MinIO.
- `inline()` — обратное: файлы из MinIO → data-URL. Используется экспортом, чтобы бандл был
  самодостаточным и импортировался любой версией сервиса (формат transfer v1).
"""
from __future__ import annotations

import base64
import binascii
import io
import mimetypes
import re
import uuid as _uuid
from typing import Any
from urllib.parse import quote, unquote

from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.minio_client import get_minio
from app.models.attachment import Attachment

FILE_URL_PREFIX = "/api/v1/attachments"
_DATA_URL_RE = re.compile(r"^data:([\w.+-]+/[\w.+-]+)?((?:;[\w-]+=[^;,]*)*)(;base64)?,(.*)$", re.S)
_FILE_URL_RE = re.compile(r"/api/v1/attachments/([0-9a-fA-F-]{36})/file")


def file_url(att: Attachment) -> str:
    return f"{FILE_URL_PREFIX}/{att.id}/file/{quote(att.filename)}"


def _legacy_key(url: str) -> str | None:
    """Абсолютная ссылка прямо на бакет (старый формат `MINIO_PUBLIC_URL/bucket/key`)."""
    marker = f"/{settings.MINIO_BUCKET}/"
    if url.startswith(("http://", "https://")) and marker in url:
        return unquote(url.split(marker, 1)[1].split("?", 1)[0])
    return None


def store_bytes(db: Session, project_id, entity_type: str, entity_id, filename: str,
                content_type: str | None, data: bytes, uploaded: list[str] | None = None) -> Attachment:
    """Кладёт файл в MinIO и создаёт строку `attachments` (flush, без commit)."""
    safe_name = (filename or "file").replace("/", "_").replace("\\", "_")[:200]
    bucket_key = f"{project_id}/{entity_type}/{entity_id}/{_uuid.uuid4()}_{safe_name}"
    get_minio().put_object(
        settings.MINIO_BUCKET, bucket_key, io.BytesIO(data), length=len(data),
        content_type=content_type or "application/octet-stream",
    )
    if uploaded is not None:
        uploaded.append(bucket_key)
    att = Attachment(
        project_id=project_id if isinstance(project_id, _uuid.UUID) else _uuid.UUID(str(project_id)),
        entity_type=entity_type,
        entity_id=str(entity_id),
        filename=safe_name,
        bucket_key=bucket_key,
        size=len(data),
        content_type=content_type,
    )
    db.add(att)
    db.flush()
    return att


def _decode_data_url(value: str) -> tuple[str, bytes, str | None] | None:
    m = _DATA_URL_RE.match(value)
    if not m:
        return None
    mime = m.group(1) or "application/octet-stream"
    params = m.group(2) or ""
    payload = m.group(4)
    try:
        data = base64.b64decode(payload) if m.group(3) else unquote(payload).encode()
    except (binascii.Error, ValueError):
        return None
    name = None
    nm = re.search(r";name=([^;]*)", params)
    if nm:
        name = unquote(nm.group(1))
    return mime, data, name


def externalize(db: Session, value: Any, project_id, entity_type: str, entity_id,
                uploaded: list[str] | None = None) -> Any:
    """Рекурсивно заменяет data-URL строки на ссылки на файлы в MinIO. Остальное — как есть."""
    if isinstance(value, str):
        if not value.startswith("data:"):
            return value
        decoded = _decode_data_url(value)
        if not decoded:
            return value
        mime, data, name = decoded
        ext = mimetypes.guess_extension(mime) or ".bin"
        att = store_bytes(db, project_id, entity_type, entity_id, name or f"attachment{ext}",
                          mime, data, uploaded)
        return file_url(att)
    if isinstance(value, list):
        return [externalize(db, v, project_id, entity_type, entity_id, uploaded) for v in value]
    if isinstance(value, dict):
        return {k: externalize(db, v, project_id, entity_type, entity_id, uploaded) for k, v in value.items()}
    return value


def has_data_urls(value: Any) -> bool:
    if isinstance(value, str):
        return value.startswith("data:")
    if isinstance(value, list):
        return any(has_data_urls(v) for v in value)
    if isinstance(value, dict):
        return any(has_data_urls(v) for v in value.values())
    return False


def read_object(bucket_key: str) -> bytes:
    resp = get_minio().get_object(settings.MINIO_BUCKET, bucket_key)
    try:
        return resp.read()
    finally:
        resp.close()
        resp.release_conn()


def _to_data_url(mime: str | None, data: bytes, filename: str | None) -> str:
    name = f";name={quote(filename)}" if filename else ""
    return f"data:{mime or 'application/octet-stream'}{name};base64,{base64.b64encode(data).decode()}"


def inline(db: Session, value: Any) -> Any:
    """Рекурсивно заменяет ссылки на файлы MinIO на data-URL. Недоступный файл — ссылка остаётся."""
    if isinstance(value, str):
        m = _FILE_URL_RE.search(value)
        try:
            if m:
                att = db.get(Attachment, _uuid.UUID(m.group(1)))
                if att:
                    return _to_data_url(att.content_type, read_object(att.bucket_key), att.filename)
            else:
                key = _legacy_key(value)
                if key:
                    att = db.query(Attachment).filter(Attachment.bucket_key == key).first()
                    mime = att.content_type if att else mimetypes.guess_type(key)[0]
                    return _to_data_url(mime, read_object(key), att.filename if att else key.rsplit("/", 1)[-1])
        except Exception:  # noqa: BLE001 — файл удалён из хранилища: оставляем ссылку
            return value
        return value
    if isinstance(value, list):
        return [inline(db, v) for v in value]
    if isinstance(value, dict):
        return {k: inline(db, v) for k, v in value.items()}
    return value


def relink_legacy(db: Session, value: Any) -> Any:
    """Абсолютные ссылки на бакет (`http://host:9000/bucket/key`) → относительные `file_url`.
    Ссылка без строки в `attachments` остаётся как есть."""
    if isinstance(value, str):
        key = _legacy_key(value)
        if not key:
            return value
        att = db.query(Attachment).filter(Attachment.bucket_key == key).first()
        return file_url(att) if att else value
    if isinstance(value, list):
        return [relink_legacy(db, v) for v in value]
    if isinstance(value, dict):
        return {k: relink_legacy(db, v) for k, v in value.items()}
    return value


def remove_objects(keys: list[str]) -> None:
    """Откат загрузок, если транзакция БД не прошла."""
    client = get_minio()
    for key in keys:
        try:
            client.remove_object(settings.MINIO_BUCKET, key)
        except Exception:  # noqa: BLE001
            pass
