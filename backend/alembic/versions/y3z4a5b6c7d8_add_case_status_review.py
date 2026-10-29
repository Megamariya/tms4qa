"""add 'review' to case_status_enum

В Python-enum CaseStatus и на фронте статус review был, а в PG-типе — нет:
создание/сохранение кейса со статусом Review падало 500 (InvalidTextRepresentation).

Revision ID: y3z4a5b6c7d8
Revises: x2y3z4a5b6c7
Create Date: 2026-10-23

"""
from alembic import op


revision = 'y3z4a5b6c7d8'
down_revision = 'x2y3z4a5b6c7'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ADD VALUE нельзя выполнять внутри транзакционного блока на старых PG — используем autocommit
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE case_status_enum ADD VALUE IF NOT EXISTS 'review'")


def downgrade() -> None:
    # Удалить значение из PG-enum нельзя без пересоздания типа; кейсы review переводим в draft
    op.execute("UPDATE test_cases SET status = 'draft' WHERE status = 'review'")
