"""add defects.display_seq, tags, actual_result

Revision ID: t5u6v7w8x9y0
Revises: s4t5u6v7w8x9
Create Date: 2026-06-13

"""
from alembic import op


revision = 't5u6v7w8x9y0'
down_revision = 's4t5u6v7w8x9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE defects ADD COLUMN IF NOT EXISTS actual_result TEXT")
    op.execute("ALTER TABLE defects ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'")
    op.execute("ALTER TABLE defects ADD COLUMN IF NOT EXISTS display_seq INTEGER")
    op.execute("""
        UPDATE defects d
        SET display_seq = sub.rn
        FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY project_id ORDER BY created_at, id) AS rn
            FROM defects
        ) sub
        WHERE d.id = sub.id AND d.display_seq IS NULL
    """)
    op.execute("ALTER TABLE defects ALTER COLUMN display_seq SET DEFAULT 1")
    op.execute("ALTER TABLE defects ALTER COLUMN display_seq SET NOT NULL")


def downgrade() -> None:
    op.execute("ALTER TABLE defects DROP COLUMN IF EXISTS actual_result")
    op.execute("ALTER TABLE defects DROP COLUMN IF EXISTS tags")
    op.execute("ALTER TABLE defects DROP COLUMN IF EXISTS display_seq")
