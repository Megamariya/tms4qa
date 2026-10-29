# project_name/backend/alembic/env.py


import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool
from alembic import context

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.core.config import settings
from app.db.base_model import Base

# ✔️ ВАЖНО: импорт моделей здесь (явно).
# Достаточно одного импорта пакета — он подтянет всё через models/__init__.py.
from app.models import (  # noqa: F401
    Organization,
    User,
    UserOrganization,
    Project,
    TestSuite,
    TestCase,
    TestPlan,
    TestRun,
    TestResult,
    Defect,
    Requirement,
)

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def get_url():
    return settings.DATABASE_URL


def run_migrations_offline():
    url = get_url()

    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    configuration = config.get_section(config.config_ini_section)
    configuration["sqlalchemy.url"] = get_url()

    connectable = engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()