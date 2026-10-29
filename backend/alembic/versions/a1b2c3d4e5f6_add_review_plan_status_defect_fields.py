"""add review status, plan status, defect fields

Revision ID: a1b2c3d4e5f6
Revises: d5e6f7a8b9c0
Create Date: 2026-05-06 12:00:00.000000

"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'a1b2c3d4e5f6'
down_revision = 'd5e6f7a8b9c0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Already applied to DB — migration file restored for alembic chain tracking
    pass


def downgrade() -> None:
    pass
