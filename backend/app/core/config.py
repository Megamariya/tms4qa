import os
from dotenv import load_dotenv
from functools import lru_cache

load_dotenv()


class Settings:
    # =========================
    # Database
    # =========================
    DATABASE_URL: str = os.getenv("DATABASE_URL", "")

    # =========================
    # JWT Auth
    # =========================
    JWT_SECRET: str = os.getenv("JWT_SECRET", "")
    JWT_ALGORITHM: str = os.getenv("JWT_ALGORITHM", "HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
    REFRESH_TOKEN_EXPIRE_DAYS: int = int(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS", "30"))

    # =========================
    # Super Admin bootstrap
    # =========================
    SUPERADMIN_EMAIL: str = os.getenv("SUPERADMIN_EMAIL", "admin@system.local")
    SUPERADMIN_PASSWORD: str = os.getenv("SUPERADMIN_PASSWORD", "")

    # =========================
    # CORS
    # =========================
    ALLOWED_ORIGINS: list = ["http://localhost:5173", "http://localhost:3000", "*"]

    # =========================
    # MinIO
    # =========================
    MINIO_URL: str = os.getenv("MINIO_URL", "minio:9000")
    MINIO_ROOT_USER: str = os.getenv("MINIO_ROOT_USER", "minioadmin")
    MINIO_ROOT_PASSWORD: str = os.getenv("MINIO_ROOT_PASSWORD", "minioadmin")
    MINIO_BUCKET: str = os.getenv("MINIO_BUCKET", "tms-attachments")
    MINIO_PUBLIC_URL: str = os.getenv("MINIO_PUBLIC_URL", "http://localhost:9000")


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
