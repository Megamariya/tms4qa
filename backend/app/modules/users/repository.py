from sqlalchemy.orm import Session

from app.models.user import User


def create_user(db: Session, data):

    user = User(**data.dict())

    db.add(user)
    db.commit()
    db.refresh(user)

    return user


def get_users(db: Session):

    return db.query(User).all()