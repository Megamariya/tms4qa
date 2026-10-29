from __future__ import annotations

from uuid import UUID

from app.modules.checklists.repository import ChecklistRepository
from app.modules.checklists.schemas import ChecklistCreate, ChecklistUpdate


class ChecklistService:
    def __init__(self, repo: ChecklistRepository):
        self.repo = repo

    def create(self, data: ChecklistCreate):
        return self.repo.create(**data.model_dump())

    def list(self, project_id: UUID):
        return self.repo.list(project_id)

    def get(self, checklist_id: UUID):
        return self.repo.get(checklist_id)

    def update(self, checklist_id: UUID, data: ChecklistUpdate):
        changes = data.model_dump(exclude_unset=True)
        return self.repo.update(checklist_id, **changes)

    def delete(self, checklist_id: UUID):
        return self.repo.delete(checklist_id)

    # ── Привязка к прогонам ──

    def list_for_run(self, run_id: UUID):
        links = self.repo.list_for_run(run_id)
        result = []
        for link in links:
            if not link.checklist:
                continue
            result.append({
                "checklist_id": link.checklist_id,
                "title": link.checklist.title,
                "items": link.checklist.items or [],
                "checked_items": link.checked_items or [],
            })
        return result

    def attach_to_run(self, run_id: UUID, checklist_id: UUID):
        return self.repo.attach_to_run(run_id, checklist_id)

    def update_checked_items(self, run_id: UUID, checklist_id: UUID, checked_items: list[str]):
        return self.repo.update_checked_items(run_id, checklist_id, checked_items)

    def detach_from_run(self, run_id: UUID, checklist_id: UUID):
        return self.repo.detach_from_run(run_id, checklist_id)
