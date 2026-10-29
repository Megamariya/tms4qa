from sqlalchemy.orm import Session

from . import repository


def create_user(db: Session, data):

    return repository.create_user(db, data)


def get_users(db: Session):

    return repository.get_users(db)