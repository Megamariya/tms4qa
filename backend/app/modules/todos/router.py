from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from uuid import UUID

from app.db.session import get_db
from app.core.dependencies import get_current_user
from app.modules.todos.repository import TodoRepository
from app.modules.todos.service import TodoService
from app.modules.todos.schemas import TodoCreate, TodoUpdate, TodoResponse

router = APIRouter(prefix="/todos", tags=["Todos"])


def get_service(db: Session = Depends(get_db)) -> TodoService:
    return TodoService(TodoRepository(db))


def _enrich(obj, db: Session) -> TodoResponse:
    """Build TodoResponse and resolve requirement_title if linked."""
    requirement_title = None
    if obj.requirement_id is not None:
        from app.models.requirement import Requirement
        req = db.query(Requirement).filter(Requirement.id == obj.requirement_id).first()
        if req:
            requirement_title = req.title

    return TodoResponse(
        id=obj.id,
        project_id=obj.project_id,
        type=obj.type,
        title=obj.title,
        body=obj.body,
        status=obj.status,
        priority=obj.priority,
        due_date=obj.due_date,
        tags=obj.tags or [],
        jira_url=obj.jira_url,
        requirement_id=obj.requirement_id,
        created_at=obj.created_at,
        updated_at=obj.updated_at,
        requirement_title=requirement_title,
    )


@router.get("", response_model=list[TodoResponse])
def list_todos(
    project_id: UUID,
    db: Session = Depends(get_db),
    service: TodoService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    items = service.list(project_id)
    return [_enrich(item, db) for item in items]


@router.get("/{todo_id}", response_model=TodoResponse)
def get_todo(
    todo_id: UUID,
    db: Session = Depends(get_db),
    service: TodoService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    obj = service.get(todo_id)
    if not obj:
        raise HTTPException(status_code=404, detail="Todo not found")
    return _enrich(obj, db)


@router.post("", response_model=TodoResponse, status_code=201)
def create_todo(
    data: TodoCreate,
    db: Session = Depends(get_db),
    service: TodoService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    obj = service.create(data)
    return _enrich(obj, db)


@router.patch("/{todo_id}", response_model=TodoResponse)
def update_todo(
    todo_id: UUID,
    data: TodoUpdate,
    db: Session = Depends(get_db),
    service: TodoService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    obj = service.update(todo_id, data)
    if not obj:
        raise HTTPException(status_code=404, detail="Todo not found")
    return _enrich(obj, db)


@router.delete("/{todo_id}", status_code=204)
def delete_todo(
    todo_id: UUID,
    service: TodoService = Depends(get_service),
    current_user: dict = Depends(get_current_user),
):
    if not service.delete(todo_id):
        raise HTTPException(status_code=404, detail="Todo not found")
