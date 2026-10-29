"""add sequence to test_results for deterministic run ordering

Revision ID: u6v7w8x9y0z1
Revises: t5u6v7w8x9y0
Create Date: 2026-07-07

"""
from alembic import op
import sqlalchemy as sa

revision = 'u6v7w8x9y0z1'
down_revision = 't5u6v7w8x9y0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # sequence — порядок кейса внутри прогона (наследуется из порядка тест-плана
    # / явного списка test_case_ids на момент создания прогона)
    op.add_column('test_results', sa.Column('sequence', sa.Integer(), nullable=True))

    # Backfill существующих строк: порядок по created_at внутри каждого прогона
    op.execute("""
        UPDATE test_results tr
        SET sequence = sub.rn - 1
        FROM (
            SELECT id,
                   ROW_NUMBER() OVER (PARTITION BY run_id ORDER BY created_at, id) AS rn
            FROM test_results
        ) sub
        WHERE tr.id = sub.id
    """)


def downgrade() -> None:
    op.drop_column('test_results', 'sequence')
