from uuid import UUID

from app.modules.suite_orders.repository import SuiteOrderRepository
from app.modules.suite_orders.schemas import SuiteOrderData


class SuiteOrderService:
    def __init__(self, repo: SuiteOrderRepository):
        self.repo = repo

    def get(self, user_id: UUID, project_id: UUID) -> dict:
        obj = self.repo.get(user_id, project_id)
        if not obj:
            return {"root": [], "children": {}}
        return obj.order_data

    def upsert(self, user_id: UUID, project_id: UUID, data: SuiteOrderData) -> dict:
        obj = self.repo.upsert(user_id, project_id, data.model_dump())
        return obj.order_data
