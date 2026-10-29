"""add auth fields: user roles, refresh tokens, audit logs

Revision ID: p1q2r3s4t5u6
Revises: o9p0q1r2s3t4
Create Date: 2026-05-30

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = 'p1q2r3s4t5u6'
down_revision = 'o9p0q1r2s3t4'
branch_labels = None
depends_on = None

DEMO_USER_ID = '6ca400f6-a755-4198-b398-5e2e6b79ee81'
DEMO_ORG_ID  = 'd58c68f8-bc88-4591-9fc8-2fe6e462c108'


def upgrade() -> None:
    # ── 1. Create user_role_enum ──────────────────────────────────────────────
    op.execute("""
        DO $$ BEGIN
            CREATE TYPE user_role_enum AS ENUM (
                'SUPER_ADMIN','OWNER','PM','QA_LEAD',
                'TESTER','ANALYST','DEVELOPER','CTO'
            );
        EXCEPTION WHEN duplicate_object THEN NULL;
        END $$;
    """)

    # ── 2. Extend users table ─────────────────────────────────────────────────
    op.add_column('users', sa.Column('username',       sa.String(),    nullable=True))
    op.add_column('users', sa.Column('password_hash',  sa.String(),    nullable=True))
    op.add_column('users', sa.Column('first_name',     sa.String(),    nullable=True))
    op.add_column('users', sa.Column('last_name',      sa.String(),    nullable=True))
    op.add_column('users', sa.Column('organization_id',
                                     sa.UUID(),
                                     sa.ForeignKey('organizations.id'),
                                     nullable=True))
    op.add_column('users', sa.Column('role',
                                     postgresql.ENUM(
                                         'SUPER_ADMIN','OWNER','PM','QA_LEAD',
                                         'TESTER','ANALYST','DEVELOPER','CTO',
                                         name='user_role_enum', create_type=False
                                     ),
                                     nullable=True))
    op.add_column('users', sa.Column('created_at',
                                     sa.DateTime(timezone=True),
                                     server_default=sa.text('now()'),
                                     nullable=True))
    op.add_column('users', sa.Column('updated_at',
                                     sa.DateTime(timezone=True),
                                     nullable=True))

    # Unique index on username (partial — allows NULLs)
    op.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_users_username ON users (username) WHERE username IS NOT NULL")

    # ── 3. Backfill demo user ─────────────────────────────────────────────────
    op.execute(f"""
        UPDATE users SET
            username = 'demo',
            first_name = 'Demo',
            last_name = 'User',
            organization_id = '{DEMO_ORG_ID}',
            role = 'OWNER'
        WHERE id = '{DEMO_USER_ID}'
    """)

    # ── 4. Create refresh_tokens ──────────────────────────────────────────────
    op.create_table(
        'refresh_tokens',
        sa.Column('id',         sa.UUID(),          primary_key=True),
        sa.Column('user_id',    sa.UUID(),          sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('token_hash', sa.String(),        nullable=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('revoked',    sa.Boolean(),       default=False, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_refresh_tokens_token_hash', 'refresh_tokens', ['token_hash'])
    op.create_index('ix_refresh_tokens_user_id',    'refresh_tokens', ['user_id'])

    # ── 5. Create audit_logs ──────────────────────────────────────────────────
    op.create_table(
        'audit_logs',
        sa.Column('id',          sa.UUID(),          primary_key=True),
        sa.Column('actor_id',    sa.UUID(),          sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('action',      sa.String(),        nullable=False),
        sa.Column('entity_type', sa.String(),        nullable=True),
        sa.Column('entity_id',   sa.String(),        nullable=True),
        sa.Column('details',     postgresql.JSONB(), nullable=True),
        sa.Column('ip_address',  sa.String(),        nullable=True),
        sa.Column('created_at',  sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    )
    op.create_index('ix_audit_logs_actor_id',   'audit_logs', ['actor_id'])
    op.create_index('ix_audit_logs_created_at', 'audit_logs', ['created_at'])


def downgrade() -> None:
    op.drop_table('audit_logs')
    op.drop_table('refresh_tokens')
    op.drop_column('users', 'updated_at')
    op.drop_column('users', 'created_at')
    op.drop_column('users', 'role')
    op.drop_column('users', 'organization_id')
    op.drop_column('users', 'last_name')
    op.drop_column('users', 'first_name')
    op.drop_column('users', 'password_hash')
    op.drop_column('users', 'username')
    op.execute("DROP TYPE IF EXISTS user_role_enum")
