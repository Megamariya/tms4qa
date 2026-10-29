"""add attachments table

Revision ID: n8o9p0q1r2s3
Revises: m7n8o9p0q1r2
Create Date: 2026-05-22

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'n8o9p0q1r2s3'
down_revision = 'm7n8o9p0q1r2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'attachments',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('entity_type', sa.String(50), nullable=False),
        sa.Column('entity_id', sa.String(36), nullable=False),
        sa.Column('filename', sa.String(255), nullable=False),
        sa.Column('bucket_key', sa.String(500), nullable=False),
        sa.Column('size', sa.Integer, nullable=False, server_default='0'),
        sa.Column('content_type', sa.String(100), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_attachments_entity', 'attachments', ['entity_type', 'entity_id'])
    op.create_index('ix_attachments_project', 'attachments', ['project_id'])


def downgrade() -> None:
    op.drop_index('ix_attachments_project', 'attachments')
    op.drop_index('ix_attachments_entity', 'attachments')
    op.drop_table('attachments')
