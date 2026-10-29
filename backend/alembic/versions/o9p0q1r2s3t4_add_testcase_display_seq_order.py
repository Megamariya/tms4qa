"""add display_seq and display_order to test_cases

Revision ID: o9p0q1r2s3t4
Revises: n8o9p0q1r2s3
Create Date: 2026-05-25

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'o9p0q1r2s3t4'
down_revision = 'n8o9p0q1r2s3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # display_seq — стабильный порядковый номер кейса в рамках проекта (TC-N)
    op.add_column('test_cases', sa.Column('display_seq', sa.Integer(), nullable=True))
    # display_order — порядок отображения кейса внутри сьюта (для drag-n-drop)
    op.add_column('test_cases', sa.Column('display_order', sa.Integer(), nullable=False, server_default='0'))

    # Заполнить display_seq для существующих строк: per-project sequence
    op.execute("""
        UPDATE test_cases tc
        SET display_seq = sub.rn
        FROM (
            SELECT id,
                   ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id) AS rn
            FROM test_cases
        ) sub
        WHERE tc.id = sub.id
    """)

    # Сделать NOT NULL после бэкфилла
    op.alter_column('test_cases', 'display_seq', nullable=False)

    # Заполнить display_order для существующих строк: порядок по created_at внутри сьюта
    op.execute("""
        UPDATE test_cases tc
        SET display_order = sub.rn - 1
        FROM (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY COALESCE(test_suite_id::text, '__none__'), project_id
                       ORDER BY created_at, id
                   ) AS rn
            FROM test_cases
        ) sub
        WHERE tc.id = sub.id
    """)


def downgrade() -> None:
    op.drop_column('test_cases', 'display_order')
    op.drop_column('test_cases', 'display_seq')
