from __future__ import annotations

import uuid as _uuid
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File, Form
from fastapi.responses import Response, StreamingResponse
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.core.dependencies import get_current_user
from app.core.config import settings
from app.core.minio_client import get_minio
from app.models.attachment import Attachment
from app.modules.attachments.schemas import AttachmentResponse
from app.modules.attachments.storage import file_url, store_bytes
from minio.error import S3Error

router = APIRouter(prefix="/attachments", tags=["Attachments"])


def _to_response(obj: Attachment) -> AttachmentResponse:
    return AttachmentResponse(
        id=obj.id,
        project_id=obj.project_id,
        entity_type=obj.entity_type,
        entity_id=obj.entity_id,
        filename=obj.filename,
        url=file_url(obj),
        size=obj.size,
        content_type=obj.content_type,
        created_at=obj.created_at,
    )


@router.post("/upload", response_model=AttachmentResponse, status_code=201)
async def upload_attachment(
    file: UploadFile = File(...),
    entity_type: str = Form(...),
    entity_id: str = Form(...),
    project_id: str = Form(...),
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    content = await file.read()
    try:
        obj = store_bytes(db, project_id, entity_type, entity_id, file.filename or "file",
                          file.content_type, content)
    except S3Error as e:
        raise HTTPException(status_code=500, detail=f"Storage error: {e}")
    db.commit()
    db.refresh(obj)
    return _to_response(obj)


@router.get("", response_model=list[AttachmentResponse])
def list_attachments(
    entity_type: str,
    entity_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    rows = (
        db.query(Attachment)
        .filter(Attachment.entity_type == entity_type, Attachment.entity_id == entity_id)
        .order_by(Attachment.created_at)
        .all()
    )
    return [_to_response(r) for r in rows]


def _parse_range(header: str | None, size: int) -> tuple[int, int] | None:
    """`bytes=START-END` → (start, end) включительно; None — отдавать файл целиком."""
    if not header or not header.startswith("bytes=") or "," in header:
        return None
    start_s, _, end_s = header[6:].partition("-")
    try:
        if start_s:
            start = int(start_s)
            end = int(end_s) if end_s else size - 1
        else:  # suffix: последние N байт
            start, end = max(size - int(end_s), 0), size - 1
    except ValueError:
        return None
    if start >= size or start > end:
        raise HTTPException(status_code=416, detail="Range not satisfiable",
                            headers={"Content-Range": f"bytes */{size}"})
    return start, min(end, size - 1)


# Без авторизации: файл открывается через <img>/<video>, которые не умеют слать Bearer-токен.
# Доступ — по неугадываемому UUID вложения (как раньше при public-read бакете).
@router.get("/{attachment_id}/file")
@router.get("/{attachment_id}/file/{filename:path}")
def download_file(attachment_id: _uuid.UUID, request: Request, filename: str | None = None,
                  db: Session = Depends(get_db)):
    obj = db.get(Attachment, attachment_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Attachment not found")
    minio = get_minio()
    try:
        size = minio.stat_object(settings.MINIO_BUCKET, obj.bucket_key).size
    except S3Error:
        raise HTTPException(status_code=404, detail="File is missing in storage")
    headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Disposition": f"inline; filename*=UTF-8''{quote(obj.filename)}",
    }
    media_type = obj.content_type or "application/octet-stream"
    if size == 0:
        return Response(content=b"", media_type=media_type, headers=headers)
    rng = _parse_range(request.headers.get("range"), size)
    start, end = rng if rng else (0, size - 1)
    headers["Content-Length"] = str(end - start + 1)
    if rng:
        headers["Content-Range"] = f"bytes {start}-{end}/{size}"
    resp = minio.get_object(settings.MINIO_BUCKET, obj.bucket_key, offset=start, length=end - start + 1)

    def _stream():
        try:
            yield from resp.stream(256 * 1024)
        finally:
            resp.close()
            resp.release_conn()

    return StreamingResponse(_stream(), status_code=206 if rng else 200, media_type=media_type, headers=headers)


@router.delete("/{attachment_id}", status_code=204)
def delete_attachment(
    attachment_id: str,
    db: Session = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    obj = db.query(Attachment).filter(Attachment.id == _uuid.UUID(attachment_id)).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Attachment not found")
    try:
        get_minio().remove_object(settings.MINIO_BUCKET, obj.bucket_key)
    except S3Error:
        pass  # файл может быть уже удалён в хранилище
    db.delete(obj)
    db.commit()
