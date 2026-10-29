"""add organizations.website_url

Revision ID: s4t5u6v7w8x9
Revises: r3s4t5u6v7w8
Create Date: 2026-05-31

"""
from alembic import op
import sqlalchemy as sa

revision = 's4t5u6v7w8x9'
down_revision = 'r3s4t5u6v7w8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS website_url VARCHAR")


def downgrade() -> None:
    op.drop_column('organizations', 'website_url')
