"""add suite_orders table

Revision ID: k5l6m7n8o9p0
Revises: j4k5l6m7n8o9
Create Date: 2026-05-19

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'k5l6m7n8o9p0'
down_revision = 'j4k5l6m7n8o9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'suite_orders',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('project_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column(
            'order_data',
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default=sa.text('\'{"root":[],"children":{}}\'::jsonb'),
        ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['project_id'], ['projects.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'project_id', name='uq_suite_order_user_project'),
    )
    op.create_index('ix_suite_orders_project_id', 'suite_orders', ['project_id'])


def downgrade() -> None:
    op.drop_index('ix_suite_orders_project_id', table_name='suite_orders')
    op.drop_table('suite_orders')
