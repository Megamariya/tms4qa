"""fix requirements missing columns and add phone/telegram to users

Revision ID: q2r3s4t5u6v7
Revises: p1q2r3s4t5u6
Create Date: 2026-05-30

d5e6f7a8b9c0 was a no-op — requirements table was left without
req_type, parent_id, display_seq, req_status columns.
Also adds phone + telegram contact fields to users.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'q2r3s4t5u6v7'
down_revision = 'p1q2r3s4t5u6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Fix requirements table ────────────────────────────────────────────────
    op.execute("""
        ALTER TABLE requirements
          ADD COLUMN IF NOT EXISTS req_type    VARCHAR,
          ADD COLUMN IF NOT EXISTS parent_id   UUID REFERENCES requirements(id) ON DELETE SET NULL,
          ADD COLUMN IF NOT EXISTS display_seq INTEGER,
          ADD COLUMN IF NOT EXISTS req_status  VARCHAR DEFAULT 'draft'
    """)

    # ── Add contact fields to users ───────────────────────────────────────────
    op.execute("""
        ALTER TABLE users
          ADD COLUMN IF NOT EXISTS phone    VARCHAR,
          ADD COLUMN IF NOT EXISTS telegram VARCHAR
    """)


def downgrade() -> None:
    op.execute("""
        ALTER TABLE users
          DROP COLUMN IF EXISTS telegram,
          DROP COLUMN IF EXISTS phone
    """)
    op.execute("""
        ALTER TABLE requirements
          DROP COLUMN IF EXISTS req_status,
          DROP COLUMN IF EXISTS display_seq,
          DROP COLUMN IF EXISTS parent_id,
          DROP COLUMN IF EXISTS req_type
    """)
