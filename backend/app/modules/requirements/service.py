from __future__ import annotations

from uuid import UUID

from app.modules.requirements.repository import RequirementRepository
from app.modules.requirements.schemas import RequirementCreate, RequirementUpdate


class RequirementService:
    def __init__(self, repo: RequirementRepository):
        self.repo = repo

    def create(self, data: RequirementCreate):
        return self.repo.create(**data.model_dump())

    def list(self, project_id: UUID):
        items = self.repo.list(project_id)
        for item in items:
            item.case_count = len(item.test_cases)
        return items

    def get(self, req_id: UUID):
        obj = self.repo.get(req_id)
        if obj:
            obj.case_count = len(obj.test_cases)
        return obj

    def update(self, req_id: UUID, data: RequirementUpdate):
        return self.repo.update(req_id, **data.model_dump(exclude_unset=True))

    def delete(self, req_id: UUID):
        return self.repo.delete(req_id)

    def get_testcases(self, req_id: UUID):
        return self.repo.get_testcases(req_id)

    def set_testcases(self, req_id: UUID, case_ids: list[UUID]):
        return self.repo.set_testcases(req_id, case_ids)

    def link_testcase(self, req_id: UUID, case_id: UUID) -> bool:
        return self.repo.link_testcase(req_id, case_id)

    def unlink_testcase(self, req_id: UUID, case_id: UUID) -> bool:
        return self.repo.unlink_testcase(req_id, case_id)
