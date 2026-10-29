"""add shared steps tables

Revision ID: j4k5l6m7n8o9
Revises: i3j4k5l6m7n8
Create Date: 2026-05-19

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'j4k5l6m7n8o9'
down_revision = 'i3j4k5l6m7n8'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'shared_step_folders',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_shared_step_folders_project_id', 'shared_step_folders', ['project_id'])

    op.create_table(
        'shared_steps',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('folder_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('steps', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default='[]'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['folder_id'], ['shared_step_folders.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_shared_steps_project_id', 'shared_steps', ['project_id'])


def downgrade() -> None:
    op.drop_index('ix_shared_steps_project_id', table_name='shared_steps')
    op.drop_table('shared_steps')
    op.drop_index('ix_shared_step_folders_project_id', table_name='shared_step_folders')
    op.drop_table('shared_step_folders')
