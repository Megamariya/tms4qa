"""add attachments jsonb to test_results

Revision ID: f0a1b2c3d4e5
Revises: e7f8a9b0c1d2
Create Date: 2026-05-09

"""
from alembic import op
from sqlalchemy.dialects import postgresql

revision = 'f0a1b2c3d4e5'
down_revision = 'e7f8a9b0c1d2'
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "ALTER TABLE test_results ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '{}'"
    )


def downgrade():
    op.execute("ALTER TABLE test_results DROP COLUMN IF EXISTS attachments")
