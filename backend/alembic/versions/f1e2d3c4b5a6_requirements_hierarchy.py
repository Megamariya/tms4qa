"""requirements hierarchy fields

Revision ID: f1e2d3c4b5a6
Revises: a1b2c3d4e5f6
Create Date: 2026-05-06 14:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'f1e2d3c4b5a6'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # req_type, parent_id, display_seq, fk already exist from previous manual migration
    # Add missing columns: priority, external_url, status (req_status already exists)
    op.execute("""
        ALTER TABLE requirements
          ADD COLUMN IF NOT EXISTS priority VARCHAR DEFAULT 'medium',
          ADD COLUMN IF NOT EXISTS external_url VARCHAR,
          ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'new'
    """)


def downgrade() -> None:
    op.drop_column('requirements', 'status')
    op.drop_column('requirements', 'external_url')
    op.drop_column('requirements', 'priority')
