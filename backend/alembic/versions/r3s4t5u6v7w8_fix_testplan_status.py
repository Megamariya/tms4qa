"""fix test_plans missing status column (a1b2c3d4e5f6 was a no-op)

Revision ID: r3s4t5u6v7w8
Revises: q2r3s4t5u6v7
Create Date: 2026-05-30

a1b2c3d4e5f6 was marked as applied but was a no-op (pass).
test_plans was created without status column; plan_status_enum type missing.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'r3s4t5u6v7w8'
down_revision = 'q2r3s4t5u6v7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE plan_status_enum AS ENUM ('active', 'review', 'archived');
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """)

    op.execute("""
        ALTER TABLE test_plans
          ADD COLUMN IF NOT EXISTS status plan_status_enum NOT NULL DEFAULT 'active'
    """)


def downgrade() -> None:
    op.execute("ALTER TABLE test_plans DROP COLUMN IF EXISTS status")
    op.execute("DROP TYPE IF EXISTS plan_status_enum")
