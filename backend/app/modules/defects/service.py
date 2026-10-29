from uuid import UUID, uuid4

from app.models.test_run import TestResult
from app.modules.attachments.storage import externalize, has_data_urls
from app.modules.defects.repository import DefectRepository
from app.modules.defects.schemas import DefectCreate, DefectUpdate


class DefectService:
    def __init__(self, repo: DefectRepository):
        self.repo = repo

    def create(self, data: DefectCreate):
        payload = data.model_dump(exclude={"test_result_id"})
        payload["id"] = uuid4()
        # base64 из старых клиентов/бэкапов → файлы в MinIO
        if has_data_urls(payload.get("attachments")):
            payload["attachments"] = externalize(
                self.repo.db, payload["attachments"], data.project_id, "defect", payload["id"])
        result = None
        if data.test_result_id:
            result = self.repo.db.query(TestResult).filter(TestResult.id == data.test_result_id).first()
            if result and not payload.get("test_run_id"):
                payload["test_run_id"] = result.run_id
        obj = self.repo.create(**payload)
        if result:
            obj.results.append(result)
            self.repo.db.commit()
            self.repo.db.refresh(obj)
        return obj

    def list(self, project_id: UUID, status: str | None = None, test_run_id: str | None = None):
        return self.repo.list(project_id, status, test_run_id)

    def get(self, defect_id: UUID):
        return self.repo.get(defect_id)

    def update(self, defect_id: UUID, data: DefectUpdate):
        changes = data.model_dump(exclude_unset=True)
        if has_data_urls(changes.get("attachments")):
            obj = self.repo.get(defect_id)
            if not obj:
                return None
            changes["attachments"] = externalize(
                self.repo.db, changes["attachments"], obj.project_id, "defect", defect_id)
        return self.repo.update(defect_id, **changes)

    def delete(self, defect_id: UUID):
        return self.repo.delete(defect_id)
