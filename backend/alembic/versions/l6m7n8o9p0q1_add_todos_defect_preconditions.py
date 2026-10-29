"""add todos table and defect pre_conditions

Revision ID: l6m7n8o9p0q1
Revises: k5l6m7n8o9p0
Create Date: 2026-05-20

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'l6m7n8o9p0q1'
down_revision = 'k5l6m7n8o9p0'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add pre_conditions to defects
    op.add_column('defects', sa.Column('pre_conditions', sa.Text(), nullable=True))

    # Create todos table
    op.create_table(
        'todos',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False, server_default=sa.text('gen_random_uuid()')),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('type', sa.String(20), nullable=False, server_default='task'),
        sa.Column('title', sa.String(), nullable=False),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('status', sa.String(20), nullable=False, server_default='todo'),
        sa.Column('priority', sa.String(20), nullable=False, server_default='medium'),
        sa.Column('due_date', sa.Date(), nullable=True),
        sa.Column('tags', postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column('jira_url', sa.String(), nullable=True),
        sa.Column('requirement_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['requirement_id'], ['requirements.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_todos_project_id', 'todos', ['project_id'])


def downgrade() -> None:
    op.drop_index('ix_todos_project_id', table_name='todos')
    op.drop_table('todos')
    op.drop_column('defects', 'pre_conditions')
