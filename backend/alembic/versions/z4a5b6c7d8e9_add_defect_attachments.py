"""add defects.attachments (JSONB list of file URLs)

Вложения дефектов раньше жили только в localStorage браузера. Теперь — список
ссылок на файлы в MinIO (`/api/v1/attachments/{id}/file/...`), как у test_results.

Revision ID: z4a5b6c7d8e9
Revises: y3z4a5b6c7d8
Create Date: 2026-10-27

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'z4a5b6c7d8e9'
down_revision = 'y3z4a5b6c7d8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'defects',
        sa.Column('attachments', postgresql.JSONB(), server_default='[]', nullable=False),
    )


def downgrade() -> None:
    op.drop_column('defects', 'attachments')
