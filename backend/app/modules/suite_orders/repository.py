from sqlalchemy.orm import Session
from uuid import UUID

from app.models.suite_order import SuiteOrder


class SuiteOrderRepository:
    def __init__(self, db: Session):
        self.db = db

    def get(self, user_id: UUID, project_id: UUID) -> SuiteOrder | None:
        return (
            self.db.query(SuiteOrder)
            .filter(SuiteOrder.user_id == user_id, SuiteOrder.project_id == project_id)
            .first()
        )

    def upsert(self, user_id: UUID, project_id: UUID, order_data: dict) -> SuiteOrder:
        obj = self.get(user_id, project_id)
        if obj:
            obj.order_data = order_data
        else:
            obj = SuiteOrder(user_id=user_id, project_id=project_id, order_data=order_data)
            self.db.add(obj)
        self.db.commit()
        self.db.refresh(obj)
        return obj
