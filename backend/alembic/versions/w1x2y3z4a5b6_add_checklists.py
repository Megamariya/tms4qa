"""add checklists tables

Revision ID: w1x2y3z4a5b6
Revises: v7w8x9y0z1a2
Create Date: 2026-08-09

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'w1x2y3z4a5b6'
down_revision = 'v7w8x9y0z1a2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'checklists',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('title', sa.String(255), nullable=False),
        sa.Column('items', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_checklists_project_id', 'checklists', ['project_id'])

    op.create_table(
        'test_run_checklists',
        sa.Column('run_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('checklist_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('checked_items', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('added_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.ForeignKeyConstraint(['run_id'], ['test_runs.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['checklist_id'], ['checklists.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('run_id', 'checklist_id'),
    )


def downgrade() -> None:
    op.drop_table('test_run_checklists')
    op.drop_index('ix_checklists_project_id', table_name='checklists')
    op.drop_table('checklists')
