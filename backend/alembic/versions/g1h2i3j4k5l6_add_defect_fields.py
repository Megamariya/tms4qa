"""add steps_to_reproduce expected_result environment to defects

Revision ID: g1h2i3j4k5l6
Revises: f0a1b2c3d4e5
Create Date: 2026-05-09

"""
from alembic import op

revision = 'g1h2i3j4k5l6'
down_revision = 'f0a1b2c3d4e5'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE defects ADD COLUMN IF NOT EXISTS steps_to_reproduce TEXT")
    op.execute("ALTER TABLE defects ADD COLUMN IF NOT EXISTS expected_result TEXT")
    op.execute("ALTER TABLE defects ADD COLUMN IF NOT EXISTS environment VARCHAR(50)")


def downgrade():
    op.execute("ALTER TABLE defects DROP COLUMN IF EXISTS steps_to_reproduce")
    op.execute("ALTER TABLE defects DROP COLUMN IF EXISTS expected_result")
    op.execute("ALTER TABLE defects DROP COLUMN IF EXISTS environment")
