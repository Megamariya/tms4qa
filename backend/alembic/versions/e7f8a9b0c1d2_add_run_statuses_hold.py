"""add ready_to_start on_hold run statuses and hold_reason

Revision ID: e7f8a9b0c1d2
Revises: f1e2d3c4b5a6
Create Date: 2026-05-08

"""
from alembic import op

revision = 'e7f8a9b0c1d2'
down_revision = 'f1e2d3c4b5a6'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TYPE run_status_enum ADD VALUE IF NOT EXISTS 'ready_to_start'")
    op.execute("ALTER TYPE run_status_enum ADD VALUE IF NOT EXISTS 'on_hold'")
    op.execute("ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS hold_reason TEXT")


def downgrade():
    op.execute("ALTER TABLE test_runs DROP COLUMN IF EXISTS hold_reason")
    # PostgreSQL does not support removing enum values
