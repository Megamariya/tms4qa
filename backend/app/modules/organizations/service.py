from uuid import UUID
from app.modules.organizations.repository import OrganizationRepository


class OrganizationService:

    def __init__(self):
        self.repo = OrganizationRepository()

    def create(self, db, data, user_id: UUID):
        """
        Создание организации и привязка пользователя (owner)
        """
        return self.repo.create(db, data, user_id)

    def list_by_user(self, db, user_id: UUID):
        """
        Получить все организации пользователя (tenant scope)
        """
        return self.repo.list_by_user(db, user_id)

    def get(self, db, org_id: UUID, user_id: UUID):
        """
        Получить организацию с проверкой tenant доступа
        """
        return self.repo.get(db, org_id, user_id)

    def delete(self, db, organization):
        """
        Удаление организации (можно позже добавить role check)
        """
        return self.repo.delete(db, organization)