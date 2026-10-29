from app.modules.projects.repository import ProjectRepository


class ProjectService:
    def __init__(self):
        self.repo = ProjectRepository()

    def get_project(self, db, project_id, organization_id):
        return self.repo.get(db, project_id, organization_id)

    def list_projects(self, db, organization_id):
        return self.repo.list(db, organization_id)

    def create_project(self, db, data, organization_id):
        return self.repo.create(db, data, organization_id)

    def update_project(self, db, project, data):
        return self.repo.update(db, project, data)

    def delete_project(self, db, project):
        self.repo.delete(db, project)
