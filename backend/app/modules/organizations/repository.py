# project_name/backend/app/core/modules/organizations/repository.py


from app.models.organization import Organization
from app.models.user_organization import UserOrganization


class OrganizationRepository:

    # ✅ создание организации + привязка пользователя как owner
    def create(self, db, data, user_id):
        org = Organization(
            name=data.name
        )

        db.add(org)
        db.flush()  # чтобы получить org.id до commit

        # создаём связь user ↔ org
        membership = UserOrganization(
            user_id=user_id,
            organization_id=org.id,
            role="owner"
        )

        db.add(membership)
        db.commit()
        db.refresh(org)

        return org

    # ✅ список организаций пользователя
    def list_by_user(self, db, user_id):
        return (
            db.query(Organization)
            .join(UserOrganization,
                  UserOrganization.organization_id == Organization.id)
            .filter(UserOrganization.user_id == user_id)
            .all()
        )

    # ✅ получить конкретную организацию пользователя
    def get(self, db, org_id, user_id):
        return (
            db.query(Organization)
            .join(UserOrganization,
                  UserOrganization.organization_id == Organization.id)
            .filter(
                Organization.id == org_id,
                UserOrganization.user_id == user_id
            )
            .first()
        )

    # ✅ удаление организации (опционально можно проверять роль)
    def delete(self, db, organization):
        db.delete(organization)
        db.commit()