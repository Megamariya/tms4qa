"""add position to testplan_cases for persisted case ordering

Revision ID: v7w8x9y0z1a2
Revises: u6v7w8x9y0z1
Create Date: 2026-07-09

"""
from alembic import op
import sqlalchemy as sa

revision = 'v7w8x9y0z1a2'
down_revision = 'u6v7w8x9y0z1'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # position — порядок кейса внутри плана (управляется вручную на странице плана),
    # наследуется прогонами при создании (см. TestResult.sequence).
    op.add_column('testplan_cases', sa.Column('position', sa.Integer(), nullable=False, server_default='0'))

    # Backfill: сохраняем текущий физический порядок строк как стартовый position
    op.execute("""
        UPDATE testplan_cases tpc
        SET position = sub.rn - 1
        FROM (
            SELECT plan_id, case_id,
                   ROW_NUMBER() OVER (PARTITION BY plan_id ORDER BY ctid) AS rn
            FROM testplan_cases
        ) sub
        WHERE tpc.plan_id = sub.plan_id AND tpc.case_id = sub.case_id
    """)


def downgrade() -> None:
    op.drop_column('testplan_cases', 'position')
