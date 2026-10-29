"""add device fields to test_runs

Revision ID: m7n8o9p0q1r2
Revises: l6m7n8o9p0q1
Create Date: 2026-05-20

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'm7n8o9p0q1r2'
down_revision = 'l6m7n8o9p0q1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('test_runs', sa.Column('device_type', sa.String(50), nullable=True))
    op.add_column('test_runs', sa.Column('os', sa.String(100), nullable=True))
    op.add_column('test_runs', sa.Column('os_version', sa.String(50), nullable=True))


def downgrade() -> None:
    op.drop_column('test_runs', 'os_version')
    op.drop_column('test_runs', 'os')
    op.drop_column('test_runs', 'device_type')
