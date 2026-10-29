"""Auth router: login / refresh / logout / me."""
from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.dependencies import get_db, get_current_user
from app.modules.auth import schemas, service

router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post("/login", response_model=schemas.TokenResponse)
def login(data: schemas.LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = service.authenticate_user(db, data.login, data.password)
    tokens = service.issue_tokens(db, user)
    service.log_action(db, actor_id=user.id, action="login",
                       entity_type="user", entity_id=str(user.id),
                       ip=request.client.host if request.client else None)
    return schemas.TokenResponse(
        **tokens,
        user=schemas.UserAuthOut.model_validate(user),
    )


@router.post("/refresh", response_model=schemas.TokenResponse)
def refresh(data: schemas.RefreshRequest, db: Session = Depends(get_db)):
    tokens = service.do_refresh(db, data.refresh_token)
    from app.models.user import User
    # Need user for response — decode access token
    from app.core.security import decode_access_token
    payload = decode_access_token(tokens["access_token"])
    user = db.query(User).filter(User.id == payload["sub"]).first()
    return schemas.TokenResponse(
        **tokens,
        user=schemas.UserAuthOut.model_validate(user),
    )


@router.post("/logout")
def logout(data: schemas.RefreshRequest, db: Session = Depends(get_db)):
    service.do_logout(db, data.refresh_token)
    return {"detail": "Logged out"}


@router.get("/me", response_model=schemas.UserAuthOut)
def me(current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    from app.models.user import User
    user = db.query(User).filter(User.id == current_user["id"]).first()
    if not user:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return schemas.UserAuthOut.model_validate(user)
