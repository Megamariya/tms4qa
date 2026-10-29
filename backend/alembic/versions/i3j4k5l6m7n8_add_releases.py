"""add releases table and release_id columns

Revision ID: i3j4k5l6m7n8
Revises: h2i3j4k5l6m7
Create Date: 2026-05-12

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'i3j4k5l6m7n8'
down_revision = 'h2i3j4k5l6m7'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'releases',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('projects.id'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('version', sa.String(100), nullable=False, server_default=''),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('environment', sa.String(50), nullable=True),
        sa.Column('status', sa.String(50), nullable=False, server_default='planned'),
        sa.Column('release_date', sa.String(20), nullable=True),
        sa.Column('requirement_ids', postgresql.JSONB(), nullable=False, server_default='[]'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.execute("ALTER TABLE test_runs ADD COLUMN IF NOT EXISTS release_id UUID")
    op.execute("ALTER TABLE test_plans ADD COLUMN IF NOT EXISTS release_id UUID")
    op.execute("ALTER TABLE defects ADD COLUMN IF NOT EXISTS release_id UUID")


def downgrade():
    op.execute("ALTER TABLE defects DROP COLUMN IF EXISTS release_id")
    op.execute("ALTER TABLE test_plans DROP COLUMN IF EXISTS release_id")
    op.execute("ALTER TABLE test_runs DROP COLUMN IF EXISTS release_id")
    op.drop_table('releases')
