from uuid import UUID, uuid4

from app.modules.attachments.storage import externalize, has_data_urls
from app.modules.testcases.repository import TestCaseRepository
from app.modules.testcases.schemas import TestCaseCreate, TestCaseUpdate


class TestCaseService:

    def __init__(self, repo: TestCaseRepository):
        self.repo = repo

    def create(self, data: TestCaseCreate):
        payload = data.dict()
        # Картинки шагов приходят base64 → переносим в MinIO
        if has_data_urls(payload.get("steps")):
            payload["id"] = uuid4()
            payload["steps"] = externalize(self.repo.db, payload["steps"], payload["project_id"],
                                           "test_case", payload["id"])
        return self.repo.create(payload)

    def get(self, test_case_id: UUID):
        return self.repo.get(test_case_id)

    def list(self, project_id: UUID | None = None):
        return self.repo.list(project_id)

    def update(self, test_case_id: UUID, data: TestCaseUpdate):
        obj = self.repo.get(test_case_id)
        if not obj:
            return None

        changes = data.dict(exclude_unset=True)
        if has_data_urls(changes.get("steps")):
            changes["steps"] = externalize(self.repo.db, changes["steps"], obj.project_id,
                                           "test_case", obj.id)
        return self.repo.update(obj, changes)

    def delete(self, test_case_id: UUID):
        obj = self.repo.get(test_case_id)
        if not obj:
            return False

        self.repo.delete(obj)
        return True

    def bulk_move_suite(self, case_ids: list, target_suite_id):
        return self.repo.bulk_move_suite(case_ids, target_suite_id)

    def batch_reorder(self, ordered_ids: list):
        self.repo.batch_reorder(ordered_ids)
