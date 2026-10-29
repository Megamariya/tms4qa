"""add testplan_cases

Revision ID: b1c2d3e4f5a6
Revises: 626e84b9fbe1
Create Date: 2026-05-04 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'b1c2d3e4f5a6'
down_revision = '626e84b9fbe1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'testplan_cases',
        sa.Column('plan_id', sa.UUID(), nullable=False),
        sa.Column('case_id', sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(['case_id'], ['test_cases.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['plan_id'], ['test_plans.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('plan_id', 'case_id'),
    )


def downgrade() -> None:
    op.drop_table('testplan_cases')
