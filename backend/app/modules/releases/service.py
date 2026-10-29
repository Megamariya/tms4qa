from uuid import UUID
from app.modules.releases.repository import ReleaseRepository
from app.modules.releases.schemas import ReleaseCreate, ReleaseUpdate


class ReleaseService:
    def __init__(self, repo: ReleaseRepository):
        self.repo = repo

    def create(self, data: ReleaseCreate):
        return self.repo.create(**data.model_dump())

    def list(self, project_id: UUID):
        return self.repo.list(project_id)

    def get(self, release_id: UUID):
        return self.repo.get(release_id)

    def update(self, release_id: UUID, data: ReleaseUpdate):
        return self.repo.update(release_id, **data.model_dump(exclude_unset=True))

    def delete(self, release_id: UUID):
        return self.repo.delete(release_id)
