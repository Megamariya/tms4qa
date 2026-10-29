from uuid import UUID

from app.modules.testsuites.repository import TestSuiteRepository
from app.modules.testsuites.schemas import TestSuiteCreate, TestSuiteUpdate


class TestSuiteService:

    def __init__(self, repo: TestSuiteRepository):
        self.repo = repo

    def create(self, data: TestSuiteCreate):
        return self.repo.create(data.dict())

    def get(self, suite_id: UUID):
        return self.repo.get(suite_id)

    def list(self, project_id: UUID):
        return self.repo.list(project_id)

    def update(self, suite_id: UUID, data: TestSuiteUpdate):
        obj = self.repo.get(suite_id)
        if not obj:
            return None
        return self.repo.update(obj, data.dict(exclude_unset=True))

    def delete(self, suite_id: UUID):
        obj = self.repo.get(suite_id)
        if not obj:
            return False
        self.repo.delete(obj)
        return True

    def delete_subtree(self, suite_id: UUID, keep_cases: bool = False) -> bool:
        return self.repo.delete_subtree(suite_id, keep_cases)