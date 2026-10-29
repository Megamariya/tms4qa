"""add defects.test_run_id (привязка дефекта к прогону)

Revision ID: x2y3z4a5b6c7
Revises: w1x2y3z4a5b6
Create Date: 2026-10-23

"""
from alembic import op


revision = 'x2y3z4a5b6c7'
down_revision = 'w1x2y3z4a5b6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE defects ADD COLUMN IF NOT EXISTS test_run_id UUID")
    op.execute("""
        DO $$ BEGIN
            ALTER TABLE defects ADD CONSTRAINT fk_defects_test_run
                FOREIGN KEY (test_run_id) REFERENCES test_runs(id) ON DELETE SET NULL;
        EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_defects_test_run_id ON defects (test_run_id)")
    # Бэкфилл из существующих связей defect_results → test_results.run_id
    op.execute("""
        UPDATE defects d SET test_run_id = sub.run_id
        FROM (
            SELECT DISTINCT ON (dr.defect_id) dr.defect_id, tr.run_id
            FROM defect_results dr JOIN test_results tr ON tr.id = dr.result_id
            ORDER BY dr.defect_id, tr.created_at
        ) sub
        WHERE d.id = sub.defect_id AND d.test_run_id IS NULL
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_defects_test_run_id")
    op.execute("ALTER TABLE defects DROP CONSTRAINT IF EXISTS fk_defects_test_run")
    op.execute("ALTER TABLE defects DROP COLUMN IF EXISTS test_run_id")
