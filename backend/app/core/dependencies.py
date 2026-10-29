"""FastAPI dependencies: DB session + current user.

get_current_user теперь — реальный JWT resolver из security.py.
Все роутеры, которые делают Depends(get_current_user), получают реальный
объект пользователя или dev-mock при отсутствии токена в режиме разработки.
"""
from app.db.session import SessionLocal


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# Re-export real get_current_user from security so all existing imports keep working
from app.core.security import get_current_user  # noqa: E402,F401
