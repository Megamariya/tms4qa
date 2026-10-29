from uuid import UUID
from sqlalchemy import func, text

from app.models.project import Project
from app.models.test_case import TestCase


class ProjectRepository:
    def get(self, db, project_id: UUID, organization_id: UUID):
        project = (
            db.query(Project)
            .filter(
                Project.id == project_id,
                Project.organization_id == organization_id,
            )
            .first()
        )
        if project:
            project.case_count = db.query(func.count(TestCase.id)).filter(
                TestCase.project_id == project_id
            ).scalar() or 0
        return project

    def list(self, db, organization_id: UUID):
        projects = (
            db.query(Project)
            .filter(Project.organization_id == organization_id)
            .order_by(Project.created_at.desc())
            .all()
        )
        counts = dict(
            db.query(TestCase.project_id, func.count(TestCase.id))
            .filter(TestCase.project_id.in_([p.id for p in projects]))
            .group_by(TestCase.project_id)
            .all()
        )
        for p in projects:
            p.case_count = counts.get(p.id, 0)
        return projects

    def create(self, db, data, organization_id: UUID):
        project = Project(
            name=data.name,
            abbreviation=data.abbreviation or _auto_abbr(data.name),
            description=data.description,
            is_private=data.is_private,
            organization_id=organization_id,
        )
        db.add(project)
        db.commit()
        db.refresh(project)
        return project

    def update(self, db, project, data):
        for field, value in data.model_dump(exclude_unset=True).items():
            setattr(project, field, value)
        db.commit()
        db.refresh(project)
        return project

    def delete(self, db, project):
        """Полное каскадное удаление проекта и всех связанных данных.

        Часть FK на projects.id не имеет ON DELETE CASCADE (test_runs,
        test_plans, defects, requirements, releases, test_cases, test_suites),
        поэтому удаляем явно в порядке зависимостей. Self-referencing
        parent_id (test_suites, requirements) сначала обнуляем, чтобы
        избежать FK-violation внутри одного DELETE.
        """
        pid = project.id

        # 1. Результаты прогонов (тянет за собой defect_results по CASCADE)
        db.execute(text(
            "DELETE FROM test_results WHERE run_id IN "
            "(SELECT id FROM test_runs WHERE project_id = :pid)"
        ), {"pid": pid})

        # 2. Тест-прогоны
        db.execute(text("DELETE FROM test_runs WHERE project_id = :pid"), {"pid": pid})

        # 3. Дефекты
        db.execute(text("DELETE FROM defects WHERE project_id = :pid"), {"pid": pid})

        # 4. Тест-планы (тянет testplan_cases/testplan_suites по CASCADE)
        db.execute(text("DELETE FROM test_plans WHERE project_id = :pid"), {"pid": pid})

        # 5. Требования (сначала разрываем self-FK иерархию, затем удаляем;
        #    тянет requirement_testcases по CASCADE, todos.requirement_id -> NULL)
        db.execute(text("UPDATE requirements SET parent_id = NULL WHERE project_id = :pid"), {"pid": pid})
        db.execute(text("DELETE FROM requirements WHERE project_id = :pid"), {"pid": pid})

        # 6. Релизы
        db.execute(text("DELETE FROM releases WHERE project_id = :pid"), {"pid": pid})

        # 7. Тест-кейсы и сьюты: сначала разрываем self-FK иерархию сьютов,
        #    затем удаляем кейсы (зависят от сьютов), затем сьюты
        db.execute(text("UPDATE test_suites SET parent_id = NULL WHERE project_id = :pid"), {"pid": pid})
        db.execute(text("DELETE FROM test_cases WHERE project_id = :pid"), {"pid": pid})
        db.execute(text("DELETE FROM test_suites WHERE project_id = :pid"), {"pid": pid})

        # 8. Сам проект (attachments/suite_orders/shared_steps/
        #    shared_step_folders/todos удалятся через ON DELETE CASCADE в БД)
        db.delete(project)
        db.commit()


def _auto_abbr(name: str) -> str:
    """Грубая автогенерация: первые буквы слов, заглавные, до 4 символов."""
    words = [w for w in name.strip().split() if w]
    if not words:
        return ""
    if len(words) == 1:
        return words[0][:4].upper()
    return "".join(w[0] for w in words[:4]).upper()
