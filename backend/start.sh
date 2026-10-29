#!/bin/bash
set -e

echo "⏳ Applying database migrations..."
alembic upgrade head
echo "✅ Migrations applied"

echo "🚀 Starting backend server..."
exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
