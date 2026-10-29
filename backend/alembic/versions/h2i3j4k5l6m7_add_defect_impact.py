"""add impact to defects

Revision ID: h2i3j4k5l6m7
Revises: g1h2i3j4k5l6
Create Date: 2026-05-09

"""
from alembic import op

revision = 'h2i3j4k5l6m7'
down_revision = 'g1h2i3j4k5l6'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE defects ADD COLUMN IF NOT EXISTS impact VARCHAR(50)")


def downgrade():
    op.execute("ALTER TABLE defects DROP COLUMN IF EXISTS impact")
