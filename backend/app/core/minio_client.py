import logging
from minio import Minio
from minio.error import S3Error

from app.core.config import settings

logger = logging.getLogger("tms-minio")

_client: Minio | None = None


def get_minio() -> Minio:
    global _client
    if _client is None:
        _client = Minio(
            settings.MINIO_URL,
            access_key=settings.MINIO_ROOT_USER,
            secret_key=settings.MINIO_ROOT_PASSWORD,
            secure=False,
        )
    return _client


def ensure_bucket() -> None:
    client = get_minio()
    bucket = settings.MINIO_BUCKET
    try:
        if not client.bucket_exists(bucket):
            client.make_bucket(bucket)
            # Public read policy so browser can fetch files directly
            policy = f"""{{
                "Version":"2012-10-17",
                "Statement":[{{
                    "Effect":"Allow",
                    "Principal":"*",
                    "Action":["s3:GetObject"],
                    "Resource":["arn:aws:s3:::{bucket}/*"]
                }}]
            }}"""
            client.set_bucket_policy(bucket, policy)
            logger.info("MinIO bucket '%s' created with public-read policy", bucket)
        else:
            logger.info("MinIO bucket '%s' already exists", bucket)
    except S3Error as e:
        logger.error("MinIO bucket init error: %s", e)
