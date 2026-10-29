from __future__ import annotations

from sqlalchemy.orm import Session
from uuid import UUID

from app.models.todo import TodoItem


class TodoRepository:
    def __init__(self, db: Session):
        self.db = db

    def list(self, project_id: UUID) -> list[TodoItem]:
        return (
            self.db.query(TodoItem)
            .filter(TodoItem.project_id == project_id)
            .order_by(TodoItem.created_at.asc())
            .all()
        )

    def get(self, todo_id: UUID) -> TodoItem | None:
        return self.db.query(TodoItem).filter(TodoItem.id == todo_id).first()

    def create(self, data: dict) -> TodoItem:
        obj = TodoItem(**data)
        self.db.add(obj)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def update(self, todo_id: UUID, data: dict) -> TodoItem | None:
        obj = self.get(todo_id)
        if not obj:
            return None
        for k, v in data.items():
            setattr(obj, k, v)
        self.db.commit()
        self.db.refresh(obj)
        return obj

    def delete(self, todo_id: UUID) -> bool:
        obj = self.get(todo_id)
        if not obj:
            return False
        self.db.delete(obj)
        self.db.commit()
        return True
