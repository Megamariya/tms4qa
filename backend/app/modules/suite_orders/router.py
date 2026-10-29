from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from uuid import UUID

from app.db.session import get_db
from app.core.dependencies import get_current_user
from app.modules.suite_orders.repository import SuiteOrderRepository
from app.modules.suite_orders.service import SuiteOrderService
from app.modules.suite_orders.schemas import SuiteOrderData

router = APIRouter(prefix="/suite-orders", tags=["SuiteOrders"])


def get_service(db: Session = Depends(get_db)) -> SuiteOrderService:
    return SuiteOrderService(SuiteOrderRepository(db))


@router.get("/{project_id}", response_model=SuiteOrderData)
def get_order(
    project_id: UUID,
    service: SuiteOrderService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    return service.get(UUID(current_user["id"]), project_id)


@router.put("/{project_id}", response_model=SuiteOrderData)
def upsert_order(
    project_id: UUID,
    data: SuiteOrderData,
    service: SuiteOrderService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    return service.upsert(UUID(current_user["id"]), project_id, data)
