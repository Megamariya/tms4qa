from sqlalchemy import func
from sqlalchemy.orm import Session
from uuid import UUID

from app.models.test_case import TestCase
from app.models.test_plan import TestPlan, testplan_cases
from app.models.test_suite import TestSuite


class TestPlanRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, data: dict) -> TestPlan:
        # Автогенерация display_seq в рамках проекта
        project_id = data["project_id"]
        max_seq = (
            self.db.query(func.max(TestPlan.display_seq))
            .filter(TestPlan.project_id == project_id)
            .scalar()
        ) or 0
        obj = TestPlan(display_seq=max_seq + 1, **data)
        self.db.add(obj)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def get(self, plan_id: UUID) -> TestPlan | None:
        return self.db.query(TestPlan).filter(TestPlan.id == plan_id).first()

    def list(self, project_id: UUID) -> list[TestPlan]:
        return (
            self.db.query(TestPlan)
            .filter(TestPlan.project_id == project_id)
            .order_by(TestPlan.created_at.desc())
            .all()
        )

    def update(self, obj: TestPlan, data: dict) -> TestPlan:
        for k, v in data.items():
            setattr(obj, k, v)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def delete(self, obj: TestPlan):
        self.db.delete(obj)
        self.db.commit()

    def add_suite(self, plan: TestPlan, suite: TestSuite) -> TestPlan:
        if suite not in plan.suites:
            plan.suites.append(suite)
            self.db.commit()
        return plan

    def remove_suite(self, plan: TestPlan, suite: TestSuite) -> TestPlan:
        if suite in plan.suites:
            plan.suites.remove(suite)
            self.db.commit()
        return plan

    def set_cases(self, plan: TestPlan, cases: list) -> TestPlan:
        # cases приходят уже в нужном порядке — пишем его явно в position,
        # т.к. простой M2M-relationship не умеет проставлять доп. колонку secondary-таблицы.
        self.db.execute(testplan_cases.delete().where(testplan_cases.c.plan_id == plan.id))
        if cases:
            self.db.execute(
                testplan_cases.insert(),
                [{"plan_id": plan.id, "case_id": c.id, "position": i} for i, c in enumerate(cases)],
            )
        self.db.commit()
        self.db.refresh(plan)
        return plan
