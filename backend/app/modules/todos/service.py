from __future__ import annotations

from uuid import UUID

from app.modules.todos.repository import TodoRepository
from app.modules.todos.schemas import TodoCreate, TodoUpdate


class TodoService:
    def __init__(self, repo: TodoRepository):
        self.repo = repo

    def list(self, project_id: UUID):
        return self.repo.list(project_id)

    def get(self, todo_id: UUID):
        return self.repo.get(todo_id)

    def create(self, data: TodoCreate):
        return self.repo.create(data.model_dump())

    def update(self, todo_id: UUID, data: TodoUpdate):
        return self.repo.update(todo_id, data.model_dump(exclude_unset=True))

    def delete(self, todo_id: UUID) -> bool:
        return self.repo.delete(todo_id)
