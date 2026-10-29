"""Auth service: login, refresh, logout, bootstrap."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import (
    create_access_token,
    generate_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)
from app.models.audit_log import AuditLog
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.models.enums import UserRole


# ─────────────────────────────────────────────────────────────────────────────
# Authenticate
# ─────────────────────────────────────────────────────────────────────────────
def authenticate_user(db: Session, login: str, password: str) -> User:
    """Look up user by email or username, verify password."""
    user = (
        db.query(User)
        .filter((User.email == login) | (User.username == login))
        .first()
    )
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Invalid credentials")
    if not user.password_hash:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Password not set — contact administrator")
    if not verify_password(password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Invalid credentials")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                            detail="Account is inactive")
    return user


# ─────────────────────────────────────────────────────────────────────────────
# Issue tokens
# ─────────────────────────────────────────────────────────────────────────────
def issue_tokens(db: Session, user: User) -> dict:
    access = create_access_token({"sub": str(user.id), "role": user.role.value if user.role else None})
    refresh_raw = generate_refresh_token()
    refresh_hashed = hash_refresh_token(refresh_raw)
    expires = datetime.now(timezone.utc) + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)

    rt = RefreshToken(
        id=uuid.uuid4(),
        user_id=user.id,
        token_hash=refresh_hashed,
        expires_at=expires,
        revoked=False,
    )
    db.add(rt)
    db.commit()

    return {
        "access_token": access,
        "refresh_token": refresh_raw,
        "expires_in": settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Refresh
# ─────────────────────────────────────────────────────────────────────────────
def do_refresh(db: Session, refresh_raw: str) -> dict:
    hashed = hash_refresh_token(refresh_raw)
    rt: RefreshToken | None = (
        db.query(RefreshToken)
        .filter(RefreshToken.token_hash == hashed, RefreshToken.revoked == False)
        .first()
    )
    if not rt:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    if rt.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token expired")

    # Revoke old
    rt.revoked = True
    db.commit()

    user: User = db.query(User).filter(User.id == rt.user_id).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User inactive")

    return issue_tokens(db, user)


# ─────────────────────────────────────────────────────────────────────────────
# Logout
# ─────────────────────────────────────────────────────────────────────────────
def do_logout(db: Session, refresh_raw: str) -> None:
    hashed = hash_refresh_token(refresh_raw)
    rt = db.query(RefreshToken).filter(RefreshToken.token_hash == hashed).first()
    if rt:
        rt.revoked = True
        db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Audit log helper
# ─────────────────────────────────────────────────────────────────────────────
def log_action(db: Session, actor_id, action: str,
               entity_type: str = None, entity_id: str = None,
               details: dict = None, ip: str = None) -> None:
    entry = AuditLog(
        id=uuid.uuid4(),
        actor_id=actor_id,
        action=action,
        entity_type=entity_type,
        entity_id=str(entity_id) if entity_id else None,
        details=details,
        ip_address=ip,
    )
    db.add(entry)
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# Bootstrap: Super Admin + Demo Org + Demo Owner
# ─────────────────────────────────────────────────────────────────────────────
_DEMO_ORG_ID    = uuid.UUID("d58c68f8-bc88-4591-9fc8-2fe6e462c108")
_DEMO_ORG_NAME  = "Demo Organization"
_DEMO_OWNER_EMAIL    = "owner@demo.local"
_DEMO_OWNER_PASSWORD = "Demo123!"


def bootstrap_superadmin(db: Session) -> None:
    """Called on startup: create SUPER_ADMIN, Demo Org and Demo Owner if absent."""
    import logging
    logger = logging.getLogger("tms-auth")

    # ── 1. Super Admin ────────────────────────────────────────────────────────
    exists = db.query(User).filter(User.role == UserRole.SUPER_ADMIN).first()
    if not exists:
        email = settings.SUPERADMIN_EMAIL
        password = settings.SUPERADMIN_PASSWORD
        if not email or not password:
            logger.warning("SUPERADMIN_EMAIL/PASSWORD not set — skipping bootstrap")
            return
        user = User(
            id=uuid.uuid4(),
            email=email,
            username="superadmin",
            name="Super Admin",
            first_name="Super",
            last_name="Admin",
            password_hash=hash_password(password),
            role=UserRole.SUPER_ADMIN,
            organization_id=None,
            is_active=True,
        )
        db.add(user)
        db.commit()
        logger.info("✅ Super admin created: %s", email)
    else:
        logger.info("Super admin already exists: %s", exists.email)

    # ── 2. Demo Organization ──────────────────────────────────────────────────
    from app.models.organization import Organization
    demo_org = db.query(Organization).filter(Organization.id == _DEMO_ORG_ID).first()
    if not demo_org:
        demo_org = Organization(id=_DEMO_ORG_ID, name=_DEMO_ORG_NAME)
        db.add(demo_org)
        db.flush()
        logger.info("✅ Demo organization created: %s", _DEMO_ORG_NAME)

    # ── 3. Demo Owner ─────────────────────────────────────────────────────────
    demo_owner = db.query(User).filter(User.email == _DEMO_OWNER_EMAIL).first()
    if not demo_owner:
        demo_owner = User(
            id=uuid.uuid4(),
            email=_DEMO_OWNER_EMAIL,
            username="owner",
            name="Demo Owner",
            first_name="Demo",
            last_name="Owner",
            password_hash=hash_password(_DEMO_OWNER_PASSWORD),
            role=UserRole.OWNER,
            organization_id=_DEMO_ORG_ID,
            is_active=True,
        )
        db.add(demo_owner)
        db.commit()
        logger.info("✅ Demo owner created: %s", _DEMO_OWNER_EMAIL)
    else:
        db.commit()
        logger.info("Demo owner already exists: %s", demo_owner.email)


# ─────────────────────────────────────────────────────────────────────────────
# Bootstrap: Demo Project + 11 суитов + ~190 тест-кейсов
# ─────────────────────────────────────────────────────────────────────────────
_DEMO_PROJECT_ID   = uuid.UUID("3ea85849-47ce-47fd-b855-d5d9ceda2714")
_DEMO_PROJECT_NAME = "Demo TMS Project"


def _s(action: str, expected: str, data: str = "") -> dict:
    return {"action": action, "data": data, "expected": expected}


# Суиты и кейсы Demo Project
_DEMO_SUITES = [
  {
    "name": "Аутентификация (Authentication)",
    "desc": "Проверка авторизации, регистрации, управления сессиями и безопасности доступа.",
    "cases": [
      {"name": "Вход с валидными данными", "severity": "critical", "priority": "high",
       "desc": "Проверка входа зарегистрированного пользователя.",
       "pre": "Пользователь зарегистрирован и активен.",
       "steps": [_s("Открыть страницу Login","Страница логина открыта"),
                 _s("Ввести корректный email","Email введён"),
                 _s("Ввести корректный пароль","Пароль введён"),
                 _s("Нажать Login","Форма отправлена")],
       "post": "Пользователь авторизован. Переход на Dashboard."},
      {"name": "Вход с неверным паролем", "behavior": "negative",
       "steps": [_s("Ввести корректный email","Email введён"),
                 _s("Ввести неверный пароль","Пароль введён"),
                 _s("Нажать Login","Форма отправлена")],
       "post": "Вход не выполнен. Сообщение «Неверный логин или пароль»."},
      {"name": "Вход с несуществующим email", "behavior": "negative",
       "steps": [_s("Ввести несуществующий email","Email введён"),
                 _s("Ввести любой пароль","Пароль введён"),
                 _s("Нажать Login","Форма отправлена")],
       "post": "Ошибка авторизации."},
      {"name": "Вход без заполнения полей", "behavior": "negative",
       "steps": [_s("Оставить поля пустыми","Поля пустые"),
                 _s("Нажать Login","Кнопка недоступна")],
       "post": "Форма не отправлена."},
      {"name": "Вход только с email (без пароля)", "behavior": "negative",
       "steps": [_s("Ввести корректный email","Email введён"),
                 _s("Оставить поле пароля пустым","Поле пусто"),
                 _s("Нажать Login","Кнопка недоступна")],
       "post": "Форма не отправлена. Поле пароля подсвечено ошибкой."},
      {"name": "Logout пользователя", "severity": "critical",
       "steps": [_s("Авторизоваться в системе","Пользователь вошёл"),
                 _s("Нажать на аватар → Выйти","Выход выполнен")],
       "post": "Сессия завершена. Переход на страницу Login."},
      {"name": "Автоматический Logout по истечению сессии",
       "steps": [_s("Авторизоваться","Пользователь вошёл"),
                 _s("Не выполнять действий 30 минут","Ожидание"),
                 _s("Попытаться выполнить любое действие","Запрос")],
       "post": "Система перенаправляет на страницу Login."},
      {"name": "Refresh token — автоматическое обновление сессии", "layer": "api",
       "steps": [_s("Авторизоваться","Получен access_token + refresh_token"),
                 _s("Дождаться истечения access_token","401 Unauthorized"),
                 _s("Выполнить любой запрос","Запрос выполнен после обновления")],
       "post": "Новый access_token получен автоматически."},
      {"name": "Вход под несколькими пользователями в разных вкладках",
       "steps": [_s("Открыть вкладку 1, авторизоваться как OWNER","Авторизована"),
                 _s("Открыть вкладку 2, авторизоваться как TESTER","Авторизована")],
       "post": "Каждая вкладка работает под своим пользователем."},
      {"name": "Вход с пробелами в email", "behavior": "negative",
       "steps": [_s("Ввести email с пробелами","Email введён"),
                 _s("Ввести пароль и нажать Login","Попытка входа")],
       "post": "Система обрезает пробелы или показывает ошибку."},
      {"name": "Форма логина — автозаполнение браузером",
       "steps": [_s("Открыть форму Login","Форма открыта"),
                 _s("Разрешить браузеру заполнить данные","Данные подставлены"),
                 _s("Нажать Login","Вход выполнен")],
       "post": "Автозаполнение работает."},
      {"name": "Вход через нажатие Enter в поле пароля",
       "steps": [_s("Ввести email","Email введён"),
                 _s("Ввести пароль","Пароль введён"),
                 _s("Нажать Enter","Форма отправлена")],
       "post": "Вход выполнен аналогично нажатию кнопки Login."},
      {"name": "Поле пароля — скрытие символов",
       "steps": [_s("Ввести пароль","Символы отображаются как ●●●")],
       "post": "Пароль не отображается открытым текстом."},
      {"name": "Множественные неудачные попытки — блокировка", "severity": "major", "behavior": "negative",
       "steps": [_s("Ввести неверный пароль 5 раз подряд","Каждая попытка: ошибка")],
       "post": "После N попыток аккаунт временно блокируется или появляется капча."},
      {"name": "Состояние кнопки Login при загрузке",
       "steps": [_s("Ввести данные и нажать Login","Запрос отправлен"),
                 _s("Наблюдать состояние кнопки","Кнопка в состоянии loading")],
       "post": "Кнопка Login недоступна и показывает индикатор загрузки."},
    ],
  },
  {
    "name": "Организации (Organizations)",
    "desc": "Проверка управления организациями и распределения пользователей.",
    "cases": [
      {"name": "Создание новой организации", "severity": "critical",
       "pre": "Авторизован как SUPER_ADMIN.",
       "steps": [_s("Открыть Workspace → Organizations","Список открыт"),
                 _s("Нажать New Organization","Форма открыта"),
                 _s("Ввести название и данные владельца","Заполнено"),
                 _s("Нажать Create","Организация создана")],
       "post": "Организация появляется в списке."},
      {"name": "Уникальность названия организации", "behavior": "negative",
       "steps": [_s("Создать организацию «Demo»","Создана"),
                 _s("Создать ещё одну с тем же названием","Попытка")],
       "post": "Ошибка: организация с таким названием уже существует."},
      {"name": "Просмотр списка организаций (SUPER_ADMIN)",
       "steps": [_s("Авторизоваться как SUPER_ADMIN","Вошли"),
                 _s("Открыть Workspace → Organizations","Страница открыта")],
       "post": "Отображаются все организации."},
      {"name": "Переключение контекста организации (SUPER_ADMIN)",
       "steps": [_s("Нажать на selector организации в TopBar","Dropdown открыт"),
                 _s("Выбрать другую организацию","Выбрана")],
       "post": "Контекст переключён. Данные перезагружены."},
      {"name": "OWNER видит только свою организацию",
       "pre": "Авторизован как OWNER.",
       "steps": [_s("Открыть Workspace","Workspace открыт")],
       "post": "Отображается только организация OWNER."},
      {"name": "Создание организации без названия", "behavior": "negative",
       "steps": [_s("Открыть форму создания","Форма открыта"),
                 _s("Оставить поле названия пустым","Пустое"),
                 _s("Нажать Create","Попытка")],
       "post": "Организация не создана. Поле подсвечено ошибкой."},
      {"name": "Максимальная длина названия организации",
       "steps": [_s("Ввести название из 255 символов","Введено"),
                 _s("Сохранить","Организация создана")],
       "post": "Организация создана. Название отображается корректно."},
      {"name": "Просмотр статистики организации",
       "steps": [_s("Открыть карточку организации","Детали открыты")],
       "post": "Отображаются: кол-во проектов, пользователей, дата создания."},
      {"name": "Badge организации в TopBar внутри проекта",
       "steps": [_s("Зайти в проект","Открыта страница проекта")],
       "post": "Рядом с логотипом отображается badge с названием организации."},
      {"name": "Создание организации со спецсимволами в названии",
       "steps": [_s("Ввести название: «Test & Demo — Org #1»","Введено"),
                 _s("Сохранить","Организация создана")],
       "post": "Организация создана. Специальные символы сохранены."},
      {"name": "Org selector — поиск в dropdown",
       "steps": [_s("Открыть org selector в TopBar","Dropdown открыт"),
                 _s("Начать набор названия","Список фильтруется")],
       "post": "Отображаются только соответствующие организации."},
      {"name": "Создание проекта в контексте организации",
       "steps": [_s("Выбрать организацию в TopBar","Org выбрана"),
                 _s("Создать новый проект","Проект создан")],
       "post": "Проект привязан к выбранной организации."},
      {"name": "Список пользователей организации",
       "steps": [_s("Открыть Workspace → Users","Список пользователей"),
                 _s("Выбрать организацию (SUPER_ADMIN)","Фильтр применён")],
       "post": "Все пользователи организации с ролями."},
      {"name": "Деактивация организации", "severity": "major",
       "steps": [_s("Открыть настройки организации","Открыты"),
                 _s("Выбрать деактивацию","Подтверждение")],
       "post": "Организация деактивирована."},
      {"name": "Изоляция данных между организациями",
       "steps": [_s("Создать проект в Org A","Создан"),
                 _s("Переключиться на Org B","Контекст Org B"),
                 _s("Открыть список проектов","Проекты загружены")],
       "post": "Проекты Org A не отображаются в контексте Org B."},
    ],
  },
  {
    "name": "Пользователи (Users)",
    "desc": "Проверка управления пользователями внутри организации.",
    "cases": [
      {"name": "Создание пользователя (OWNER/SUPER_ADMIN)", "severity": "critical",
       "pre": "Авторизован как OWNER или SUPER_ADMIN.",
       "steps": [_s("Открыть Workspace → Users","Список"),
                 _s("Нажать Add User","Форма открыта"),
                 _s("Заполнить: имя, email, роль, пароль","Заполнено"),
                 _s("Нажать Save","Пользователь создан")],
       "post": "Пользователь добавлен и может авторизоваться."},
      {"name": "Уникальность Email при создании", "behavior": "negative",
       "steps": [_s("Создать пользователя с email user@demo.local","Создан"),
                 _s("Повторно создать с тем же email","Попытка")],
       "post": "Ошибка: пользователь с таким email уже существует."},
      {"name": "Деактивация пользователя",
       "steps": [_s("Найти пользователя","Найден"),
                 _s("Нажать Деактивировать → Подтвердить","Подтверждено")],
       "post": "Пользователь помечен как неактивный. Не может авторизоваться."},
      {"name": "Смена роли пользователя",
       "steps": [_s("Открыть пользователя","Данные открыты"),
                 _s("Выбрать новую роль в dropdown","Роль выбрана"),
                 _s("Подтвердить","Роль изменена")],
       "post": "Роль обновлена."},
      {"name": "Редактирование контактных данных",
       "steps": [_s("Нажать Редактировать у пользователя","Форма открыта"),
                 _s("Изменить email, телефон, telegram","Изменено"),
                 _s("Сохранить","Сохранено")],
       "post": "Контактные данные обновлены."},
      {"name": "CTO видит список без кнопок управления",
       "pre": "Авторизован как CTO.",
       "steps": [_s("Открыть Workspace → Users","Список открыт")],
       "post": "Кнопки «Редактировать» и «Деактивировать» отсутствуют."},
      {"name": "TESTER не имеет доступа к Workspace Users", "behavior": "negative",
       "pre": "Авторизован как TESTER.",
       "steps": [_s("Попытаться открыть Workspace → Users","Навигация")],
       "post": "Раздел недоступен или пуст."},
      {"name": "Поиск пользователя по имени",
       "steps": [_s("Ввести имя в поле поиска","Фильтр применён")],
       "post": "Отображаются только пользователи с искомым именем."},
      {"name": "Поиск пользователя по email",
       "steps": [_s("Ввести email в поиск","Фильтр применён")],
       "post": "Фильтрация работает по полю email."},
      {"name": "Создание пользователя без обязательных полей", "behavior": "negative",
       "steps": [_s("Открыть форму Add User","Открыта"),
                 _s("Оставить email пустым","Email не заполнен"),
                 _s("Нажать Save","Попытка")],
       "post": "Поле email подсвечено ошибкой."},
      {"name": "Инициалы пользователя в аватаре",
       "steps": [_s("Создать пользователя «Иван Петров»","Создан"),
                 _s("Найти аватар","Виден")],
       "post": "Аватар содержит инициалы «ИП»."},
      {"name": "Список пользователей с прокруткой",
       "steps": [_s("Добавить > 50 пользователей","Созданы"),
                 _s("Открыть список","Открыт")],
       "post": "Список корректно отображает всех пользователей."},
      {"name": "Смена собственного пароля",
       "steps": [_s("Открыть профиль","Открыт"),
                 _s("Ввести текущий пароль","Введён"),
                 _s("Ввести новый пароль","Введён"),
                 _s("Сохранить","Сохранено")],
       "post": "Пароль изменён. Вход со старым невозможен."},
      {"name": "Badge роли у пользователя",
       "steps": [_s("Открыть список пользователей","Открыт")],
       "post": "Каждый пользователь имеет цветной badge с ролью."},
      {"name": "Создание пользователя — валидация email", "behavior": "negative",
       "steps": [_s("Ввести некорректный email","Введено"),
                 _s("Нажать Save","Попытка")],
       "post": "Ошибка: некорректный формат email."},
      {"name": "Переактивация деактивированного пользователя",
       "steps": [_s("Найти деактивированного пользователя","Найден"),
                 _s("Нажать Активировать","Пользователь активирован")],
       "post": "Пользователь снова может авторизоваться."},
      {"name": "Фильтр пользователей по роли",
       "steps": [_s("Выбрать роль в фильтре (TESTER)","Фильтр применён")],
       "post": "Список содержит только пользователей с ролью TESTER."},
      {"name": "Telegram и телефон в профиле",
       "steps": [_s("Заполнить phone и telegram","Сохранено"),
                 _s("Открыть карточку","Открыта")],
       "post": "Поля phone и telegram отображаются."},
      {"name": "OWNER не может изменить свою роль", "behavior": "negative",
       "steps": [_s("Авторизоваться как OWNER","Вошли"),
                 _s("Попытаться изменить собственную роль","Попытка")],
       "post": "Роль собственного аккаунта не изменяется."},
      {"name": "SUPER_ADMIN не отображается в dropdown ролей OWNER",
       "steps": [_s("Авторизоваться как OWNER","Вошли"),
                 _s("Открыть dropdown смены роли","Открыт")],
       "post": "Роль SUPER_ADMIN недоступна в dropdown."},
      {"name": "Приглашение по email",
       "steps": [_s("Создать пользователя в системе","Создан"),
                 _s("Проверить email (если SMTP)","Email получен")],
       "post": "Email содержит ссылку для первого входа."},
    ],
  },
  {
    "name": "Роли и права доступа (RBAC)",
    "desc": "Проверка разграничения доступа по ролям.",
    "cases": [
      {"name": "QA_LEAD может создавать тест-кейсы",
       "pre": "Авторизован как QA_LEAD.",
       "steps": [_s("Открыть Test Cases","Открыто"),
                 _s("Нажать + Manual test","Форма открыта"),
                 _s("Заполнить и сохранить","Кейс создан")],
       "post": "Тест-кейс создан."},
      {"name": "TESTER не может удалять проект", "behavior": "negative",
       "pre": "Авторизован как TESTER.",
       "steps": [_s("Открыть настройки проекта","Настройки"),
                 _s("Найти кнопку Delete Project","Поиск")],
       "post": "Кнопка Delete Project отсутствует."},
      {"name": "OWNER управляет пользователями",
       "pre": "Авторизован как OWNER.",
       "steps": [_s("Открыть Workspace → Users","Список"),
                 _s("Добавить пользователя","Создан")],
       "post": "Пользователь создан."},
      {"name": "CTO имеет read-only доступ",
       "pre": "Авторизован как CTO.",
       "steps": [_s("Открыть Test Cases","Открыто"),
                 _s("Попытаться создать кейс","Попытка")],
       "post": "Кнопки создания/редактирования отсутствуют."},
      {"name": "ANALYST управляет требованиями",
       "pre": "Авторизован как ANALYST.",
       "steps": [_s("Открыть Requirements","Открыто"),
                 _s("Создать требование","Создано")],
       "post": "Требование создано."},
      {"name": "DEVELOPER работает с дефектами",
       "pre": "Авторизован как DEVELOPER.",
       "steps": [_s("Открыть Defects","Открыто"),
                 _s("Создать дефект","Создан"),
                 _s("Изменить статус","Изменён")],
       "post": "Дефект создан и статус изменён."},
      {"name": "SUPER_ADMIN видит все организации",
       "pre": "Авторизован как SUPER_ADMIN.",
       "steps": [_s("Открыть Workspace → Organizations","Открыто")],
       "post": "Все организации системы видны."},
      {"name": "TESTER может запускать тест-прогоны",
       "pre": "Авторизован как TESTER.",
       "steps": [_s("Открыть Test Runs","Открыто"),
                 _s("Нажать New Run","Форма"),
                 _s("Создать прогон","Создан")],
       "post": "Прогон создан."},
      {"name": "PM управляет тест-планами",
       "pre": "Авторизован как PM.",
       "steps": [_s("Открыть Test Plans","Открыто"),
                 _s("Создать план","Создан")],
       "post": "Тест-план создан."},
      {"name": "TESTER не может изменить настройки проекта", "behavior": "negative",
       "pre": "Авторизован как TESTER.",
       "steps": [_s("Открыть Settings","Попытка")],
       "post": "Настройки недоступны или read-only."},
      {"name": "Смена роли применяется немедленно",
       "steps": [_s("Сменить роль TESTER → QA_LEAD","Сменена"),
                 _s("Выполнить действие QA_LEAD","Выполнено")],
       "post": "Права применяются без повторного входа."},
      {"name": "OWNER не может создать SUPER_ADMIN", "behavior": "negative",
       "pre": "Авторизован как OWNER.",
       "steps": [_s("Открыть Add User","Форма"),
                 _s("Попытаться выбрать SUPER_ADMIN","Попытка")],
       "post": "Роль SUPER_ADMIN отсутствует в dropdown."},
      {"name": "ANALYST не может запускать прогоны", "behavior": "negative",
       "pre": "Авторизован как ANALYST.",
       "steps": [_s("Открыть Test Runs","Открыто"),
                 _s("Попытаться создать прогон","Попытка")],
       "post": "Кнопка New Run отсутствует или заблокирована."},
      {"name": "Матрица разрешений в Settings",
       "steps": [_s("Открыть Settings → Роли и доступ","Открыто")],
       "post": "8 ролей с описаниями и матрицей разрешений."},
      {"name": "QA_LEAD может создавать тест-планы",
       "pre": "Авторизован как QA_LEAD.",
       "steps": [_s("Открыть Test Plans","Открыто"),
                 _s("Создать план","Создан")],
       "post": "Тест-план создан."},
      {"name": "DEVELOPER не может создавать тест-кейсы", "behavior": "negative",
       "pre": "Авторизован как DEVELOPER.",
       "steps": [_s("Открыть Test Cases","Открыто"),
                 _s("Попытаться создать кейс","Попытка")],
       "post": "Кнопка + Manual test отсутствует или недоступна."},
      {"name": "Роли отображаются badge в Workspace",
       "steps": [_s("Открыть Workspace → Users","Список")],
       "post": "Каждая роль — цветной badge."},
      {"name": "Журнал аудита доступен только SUPER_ADMIN", "behavior": "negative",
       "pre": "Авторизован как OWNER.",
       "steps": [_s("GET /api/v1/audit","Запрос")],
       "post": "403 Forbidden."},
      {"name": "SUPER_ADMIN может назначить роль OWNER",
       "pre": "Авторизован как SUPER_ADMIN.",
       "steps": [_s("Открыть пользователя","Открыт"),
                 _s("Выбрать роль OWNER","Выбрана"),
                 _s("Сохранить","Сохранено")],
       "post": "Роль OWNER назначена."},
      {"name": "Кейс TESTER имеет статус Review",
       "pre": "Авторизован как TESTER.",
       "steps": [_s("Создать тест-кейс","Создан")],
       "post": "Статус — «Review»."},
      {"name": "QA_LEAD одобряет кейс TESTER",
       "pre": "Авторизован как QA_LEAD. Кейс со статусом Review существует.",
       "steps": [_s("Открыть кейс Review","Открыт"),
                 _s("Изменить статус на Actual","Изменён")],
       "post": "Статус — «Actual»."},
      {"name": "RBAC — изоляция данных между организациями", "behavior": "negative",
       "pre": "Авторизован как OWNER Org A.",
       "steps": [_s("Обратиться к проекту Org B через API","Запрос")],
       "post": "403 или 404."},
      {"name": "PM видит отчёты и дашборды",
       "pre": "Авторизован как PM.",
       "steps": [_s("Открыть Dashboard","Открыт"),
                 _s("Открыть Reports","Открыт")],
       "post": "Dashboard и Reports доступны."},
      {"name": "CTO может экспортировать отчёт",
       "pre": "Авторизован как CTO.",
       "steps": [_s("Открыть Reports","Открыто"),
                 _s("Нажать экспорт","Файл скачан")],
       "post": "Отчёт экспортирован."},
      {"name": "Матрица разрешений — 8 ролей в Settings", "layer": "ui",
       "steps": [_s("Открыть Settings → Roles & Access","Открыто")],
       "post": "8 ролей с описаниями и матрицей."},
    ],
  },
  {
    "name": "Проекты (Projects)",
    "desc": "Проверка управления проектами.",
    "cases": [
      {"name": "Создание нового проекта", "severity": "critical",
       "steps": [_s("Нажать Create Project","Форма открыта"),
                 _s("Заполнить название и описание","Заполнено"),
                 _s("Сохранить","Проект создан")],
       "post": "Проект отображается в списке."},
      {"name": "Переход в проект открывает My Dashboard",
       "steps": [_s("Кликнуть на название проекта","Переход")],
       "post": "Открывается My Dashboard проекта."},
      {"name": "Создание проекта без названия", "behavior": "negative",
       "steps": [_s("Открыть форму","Открыта"),
                 _s("Оставить название пустым","Пустое"),
                 _s("Нажать Save","Попытка")],
       "post": "Ошибка валидации на поле Name."},
      {"name": "Редактирование проекта",
       "steps": [_s("Открыть проект","Открыт"),
                 _s("Нажать Edit","Форма"),
                 _s("Изменить описание","Изменено"),
                 _s("Сохранить","Сохранено")],
       "post": "Изменения сохранены."},
      {"name": "Архивация проекта",
       "steps": [_s("Открыть настройки","Настройки"),
                 _s("Выбрать Archive → Подтвердить","Архивирован")],
       "post": "Проект в архиве."},
      {"name": "Поиск проекта по названию",
       "steps": [_s("Ввести часть названия в поиск","Фильтр")],
       "post": "Только соответствующие проекты."},
      {"name": "Переключение Table/Cards представления",
       "steps": [_s("Нажать Card View","Изменён"),
                 _s("Нажать Table View","Изменён")],
       "post": "Вид переключается. Сохраняется в localStorage."},
      {"name": "Карточка проекта — отображение команды",
       "steps": [_s("Открыть Projects (Card View)","Карточки")],
       "post": "Owner, PM, кол-во QA и разработчиков."},
      {"name": "SUPER_ADMIN видит org badge у проекта",
       "pre": "Авторизован как SUPER_ADMIN.",
       "steps": [_s("Открыть Projects","Список")],
       "post": "Badge с организацией у каждого проекта."},
      {"name": "OWNER не видит org badge",
       "pre": "Авторизован как OWNER.",
       "steps": [_s("Открыть Projects","Список")],
       "post": "Org badge отсутствует."},
      {"name": "Уникальность названия в организации", "behavior": "negative",
       "steps": [_s("Создать «Demo»","Создан"),
                 _s("Создать второй «Demo»","Попытка")],
       "post": "Ошибка: уже существует."},
      {"name": "Статус проекта в списке",
       "steps": [_s("Открыть Projects","Список")],
       "post": "Каждый проект имеет статус."},
      {"name": "SUPER_ADMIN выбирает организацию при создании",
       "pre": "Авторизован как SUPER_ADMIN.",
       "steps": [_s("Открыть Create Project","Форма"),
                 _s("Выбрать организацию","Выбрана"),
                 _s("Заполнить и сохранить","Создан")],
       "post": "Проект в выбранной организации."},
      {"name": "Блок ближайшего релиза в карточке",
       "steps": [_s("Создать релиз с датой в будущем","Создан"),
                 _s("Открыть Projects","Список")],
       "post": "Ближайший релиз с датой виден в карточке."},
      {"name": "Удаление проекта",
       "steps": [_s("Нажать Delete Project","Подтверждение"),
                 _s("Подтвердить","Удалён")],
       "post": "Проект и все данные удалены."},
    ],
  },
  {
    "name": "Test Suites",
    "desc": "Проверка работы с тестовыми наборами.",
    "cases": [
      {"name": "Создание корневого Suite", "severity": "critical",
       "steps": [_s("Открыть Test Cases","Открыто"),
                 _s("Нажать + Create Suite","Форма"),
                 _s("Ввести название и сохранить","Создан")],
       "post": "Suite на корневом уровне."},
      {"name": "Создание вложенного Suite",
       "steps": [_s("Выбрать родительский Suite","Выбран"),
                 _s("Нажать + Create Child Suite","Форма"),
                 _s("Сохранить","Создан")],
       "post": "Дочерний Suite в дереве."},
      {"name": "Переименование Suite",
       "steps": [_s("Открыть контекстное меню Suite","Открыто"),
                 _s("Выбрать Edit → изменить → Save","Сохранено")],
       "post": "Новое название в дереве."},
      {"name": "Удаление Suite с перемещением кейсов",
       "steps": [_s("Delete → Keep cases → Подтвердить","Удалён")],
       "post": "Suite удалён. Кейсы → «Без Suite»."},
      {"name": "Удаление Suite вместе с кейсами", "severity": "major",
       "steps": [_s("Delete → Delete with cases → Подтвердить","Удалено")],
       "post": "Suite и все кейсы удалены."},
      {"name": "Свёртка / развёртка Suite",
       "steps": [_s("Кликнуть на стрелку рядом с Suite","Изменено")],
       "post": "Дочерние элементы скрываются/показываются синхронно в обоих панелях."},
      {"name": "Перетаскивание Suite в дереве",
       "steps": [_s("Зажать Suite и перетащить","Перемещён")],
       "post": "Suite на новой позиции."},
      {"name": "Suite с описанием",
       "steps": [_s("Создать Suite с Description","Создан")],
       "post": "Description сохранён и виден в деталях."},
      {"name": "Максимальная глубина иерархии",
       "steps": [_s("Создать Suite 5 уровней вложенности","Создано")],
       "post": "Дерево корректно отображает 5 уровней."},
      {"name": "Breadcrumbs указывает на Suite",
       "steps": [_s("Открыть тест-кейс","Открыт"),
                 _s("Просмотреть breadcrumbs","Видны")],
       "post": "Полный путь через иерархию Suite."},
      {"name": "Кол-во кейсов в Suite",
       "steps": [_s("Открыть дерево","Открыто")],
       "post": "Счётчик кейсов рядом с каждым Suite."},
      {"name": "Выбор всех кейсов Suite чекбоксом",
       "steps": [_s("Нажать чекбокс в заголовке Suite","Все отмечены")],
       "post": "Все кейсы выбраны."},
      {"name": "Поиск Suite по названию",
       "steps": [_s("Ввести часть названия в поиск","Фильтр")],
       "post": "Дерево фильтруется."},
      {"name": "Suite виден в Test Plan при добавлении кейсов",
       "steps": [_s("Открыть Test Plan → Add Cases","Форма"),
                 _s("Найти Suite","Виден"),
                 _s("Выбрать кейсы","Добавлены")],
       "post": "Все кейсы Suite в плане."},
      {"name": "Импорт Suite из JSON",
       "steps": [_s("Открыть Settings → Backup → Import","Форма"),
                 _s("Выбрать JSON и запустить","Завершён")],
       "post": "Suite и кейсы созданы с remapped ID."},
    ],
  },
  {
    "name": "Test Cases",
    "desc": "Проверка управления тест-кейсами.",
    "cases": [
      {"name": "Создание тест-кейса через форму", "severity": "critical",
       "steps": [_s("Нажать + Manual test","Форма"),
                 _s("Заполнить поля и шаги","Заполнено"),
                 _s("Сохранить","Создан")],
       "post": "Кейс в списке."},
      {"name": "Создание через Quick Create",
       "steps": [_s("Нажать + внизу folder view","Inline форма"),
                 _s("Ввести название → Enter","Создан")],
       "post": "Кейс создан без полной формы."},
      {"name": "Редактирование кейса",
       "steps": [_s("Открыть кейс → Edit","Форма"),
                 _s("Изменить шаг → Save","Сохранено")],
       "post": "Изменения сохранены. Revision+1."},
      {"name": "Дублирование кейса",
       "steps": [_s("Clone / Duplicate","Копия создана")],
       "post": "Копия с суффиксом «copy01»."},
      {"name": "Удаление кейса",
       "steps": [_s("Контекстное меню → Delete → Подтвердить","Удалён")],
       "post": "Кейс удалён."},
      {"name": "Добавление шагов",
       "steps": [_s("+ Add Step → заполнить → Save","Сохранено")],
       "post": "Шаги нумеруются автоматически."},
      {"name": "Дублирование шага",
       "steps": [_s("Кнопка дублирования на шаге","Скопирован")],
       "post": "Новый шаг ниже оригинала."},
      {"name": "Изменение порядка шагов (drag-and-drop)",
       "steps": [_s("Перетащить шаг на новую позицию","Перемещён")],
       "post": "Порядок изменён. Нумерация обновлена."},
      {"name": "Поля: Severity, Priority, Layer, Type",
       "steps": [_s("Установить Critical/High/API/Security","Выбрано"),
                 _s("Сохранить","Сохранено")],
       "post": "Все поля сохранены."},
      {"name": "Фильтрация по Severity",
       "steps": [_s("Фильтр Severity=Critical","Применён")],
       "post": "Только Critical кейсы."},
      {"name": "Поиск по названию",
       "steps": [_s("Ввести текст в поиск","Фильтр")],
       "post": "Только совпадающие кейсы."},
      {"name": "Кейс layer=API — поля API-шагов",
       "steps": [_s("Layer=API, добавить шаг GET /api/v1/test","Добавлен"),
                 _s("Expected Status=200","Заполнено"),
                 _s("Сохранить","Сохранено")],
       "post": "API-поля шага сохранены."},
      {"name": "Экспорт кейса в PDF",
       "steps": [_s("Drawer → Экспорт → PDF","Скачан")],
       "post": "PDF со всеми полями."},
      {"name": "Отображение ID (TC-N)",
       "steps": [_s("Открыть список","Открыт")],
       "post": "Каждый кейс имеет уникальный TC-N."},
      {"name": "Drag-and-drop порядок кейсов",
       "steps": [_s("Перетащить кейс на новую позицию","Перемещён")],
       "post": "Порядок сохранён."},
      {"name": "Flaky кейс",
       "steps": [_s("Включить is_flaky → Save","Включён")],
       "post": "Индикатор flaky в списке."},
      {"name": "Drawer без открытия страницы",
       "steps": [_s("Кликнуть на кейс","Drawer открыт")],
       "post": "Drawer справа с деталями."},
      {"name": "Undocked режим drawer",
       "steps": [_s("Открыть drawer → Undock","Модальное окно")],
       "post": "Кейс в полноэкранном модальном окне."},
      {"name": "Mind Map view",
       "steps": [_s("Переключиться на Mind Map View","Вид")],
       "post": "Интерактивный mind map. Pan/Zoom работают."},
      {"name": "Теги кейса",
       "steps": [_s("Добавить теги: regression, smoke → Save","Сохранены")],
       "post": "Теги на карточке и в фильтре."},
      {"name": "Pre/Post conditions",
       "steps": [_s("Заполнить Pre/Post conditions → Save","Сохранены")],
       "post": "Сохранены и видны в drawer."},
      {"name": "Статус: Actual / Review / Deprecated",
       "steps": [_s("Изменить статус на Deprecated → Save","Сохранено")],
       "post": "Badge статуса в списке."},
      {"name": "Linked Requirement",
       "steps": [_s("Привязать требование → Save","Сохранено")],
       "post": "Связь кейс↔требование. Видна в Traceability."},
      {"name": "Счётчик кейсов в Suite",
       "steps": [_s("Открыть Test Cases","Открыто")],
       "post": "Актуальный счётчик рядом с Suite."},
      {"name": "Revision растёт при каждом сохранении",
       "steps": [_s("Сохранить кейс (revision=1)","1"),
                 _s("Изменить и сохранить","2"),
                 _s("Ещё раз","3")],
       "post": "Revision последовательно растёт."},
      {"name": "Bulk selection чекбоксами",
       "steps": [_s("Отметить несколько кейсов","Отмечены")],
       "post": "Панель массовых операций появляется."},
      {"name": "Импорт кейсов из JSON",
       "steps": [_s("Settings → Backup → Import → JSON","Импорт")],
       "post": "Кейсы с правильными suite-привязками."},
      {"name": "Экспорт кейсов в JSON",
       "steps": [_s("Settings → Backup → Export → Скачать","Скачан")],
       "post": "JSON содержит все Suite и кейсы."},
      {"name": "API-runner в ExecutionDrawer", "layer": "api",
       "steps": [_s("Открыть кейс API в Drawer","Открыт"),
                 _s("▶ API → выполнить","Выполнен"),
                 _s("Просмотреть результат","Виден")],
       "post": "HTTP-запрос выполнен inline."},
      {"name": "Automation Status = Automated",
       "steps": [_s("Изменить Automation Status на Automated → Save","Изменён")],
       "post": "Кейс помечен как Automated."},
    ],
  },
  {
    "name": "Test Plans",
    "desc": "Проверка формирования тест-планов.",
    "cases": [
      {"name": "Создание тест-плана", "severity": "critical",
       "steps": [_s("Открыть Test Plans","Открыто"),
                 _s("+ New Plan → заполнить → Save","Создан")],
       "post": "Тест-план с ID R-N."},
      {"name": "Добавление Suite в план",
       "steps": [_s("Открыть план → Test Cases → + Add Cases","Форма"),
                 _s("Выбрать Suite → Подтвердить","Добавлены")],
       "post": "Все кейсы Suite в плане."},
      {"name": "Отображение ID R-N",
       "steps": [_s("Создать несколько планов","Созданы")],
       "post": "R-1, R-2, R-3, … уникальные."},
      {"name": "Фильтрация по статусу",
       "steps": [_s("Фильтр Status=Active","Применён")],
       "post": "Только активные планы."},
      {"name": "Expected Duration из истории",
       "steps": [_s("Завершить несколько прогонов","Данные сохранены"),
                 _s("Открыть план","Детали")],
       "post": "Среднее время по завершённым прогонам."},
      {"name": "Статус: Active / Review / Archived",
       "steps": [_s("Изменить статус на Archived → Save","Сохранено")],
       "post": "Plan в архиве."},
      {"name": "Печатная форма плана",
       "steps": [_s("Открыть план → Print Form tab","Открыто")],
       "post": "Iframe-превью A4 Portrait."},
      {"name": "Экспорт в CSV",
       "steps": [_s("Test Cases tab → Экспорт → CSV","Скачан")],
       "post": "CSV с TC-N, названиями, Severity, Priority."},
      {"name": "Экспорт в PDF",
       "steps": [_s("Экспорт → PDF","Скачан")],
       "post": "PDF с метаданными и кейсами."},
      {"name": "Запуск прогона из плана",
       "steps": [_s("Test Runs tab → + New Run → Create","Создан")],
       "post": "Прогон со всеми кейсами плана (Untested)."},
      {"name": "Счётчик кейсов на вкладке Test Cases",
       "steps": [_s("Открыть план → Test Cases","Открыто")],
       "post": "Актуальное кол-во в заголовке вкладки."},
      {"name": "References в плане",
       "steps": [_s("Заполнить References → Save","Сохранено")],
       "post": "References видны в деталях плана."},
      {"name": "Кейсы открываются в drawer",
       "steps": [_s("Кликнуть на кейс в Test Cases tab","Drawer открыт")],
       "post": "Drawer с деталями кейса."},
      {"name": "Sticky header в Test Cases tab",
       "steps": [_s("Прокрутить большой список кейсов","Скролл")],
       "post": "Заголовок таблицы зафиксирован."},
      {"name": "Удаление плана",
       "steps": [_s("Контекстное меню → Delete → Подтвердить","Удалён")],
       "post": "План удалён. Прогоны не удаляются."},
    ],
  },
  {
    "name": "Test Runs",
    "desc": "Проверка выполнения тестов.",
    "cases": [
      {"name": "Создание Test Run из тест-плана", "severity": "critical",
       "steps": [_s("+ New Run → выбрать план → Create","Создан")],
       "post": "Все кейсы плана (Untested)."},
      {"name": "Создание Run из репозитория",
       "steps": [_s("+ New Run → From repository → выбрать Suite → Create","Создан")],
       "post": "Прогон с выбранными кейсами."},
      {"name": "Отметка Passed",
       "steps": [_s("ExecutionDrawer → Passed","Изменён")],
       "post": "Статус Passed. Прогресс-бар обновлён."},
      {"name": "Отметка Failed + Actual Result",
       "steps": [_s("ExecutionDrawer → Failed","Изменён"),
                 _s("Заполнить Actual Result → Save","Сохранено")],
       "post": "Статус Failed. Actual Result сохранён."},
      {"name": "Статусы Blocked и Skipped",
       "steps": [_s("Отметить Blocked","Изменён"),
                 _s("Следующий кейс → Skipped","Изменён")],
       "post": "Статусы сохранены."},
      {"name": "Таймер в TopBar",
       "steps": [_s("Запустить Test Run","Запущен"),
                 _s("Обратить внимание на TopBar","Виден")],
       "post": "Пульсирующий индикатор с именем и таймером."},
      {"name": "Прогресс-бар в списке",
       "steps": [_s("Открыть список Test Runs","Список")],
       "post": "Прогресс-бар (Passed/Failed/Blocked/Untested)."},
      {"name": "Переупорядочивание кейсов стрелками",
       "steps": [_s("▲ или ▼ на кейсе","Перемещён")],
       "post": "Порядок изменён."},
      {"name": "Completion reminder",
       "steps": [_s("Завершить все кейсы","Выполнены"),
                 _s("Подтвердить завершение","Завершён")],
       "post": "Reminder с предложением экспорта."},
      {"name": "Flash-индикатор завершения в TopBar",
       "steps": [_s("Завершить прогон","Завершён")],
       "post": "Flash «✓ Прогон завершён»."},
      {"name": "Прикрепление скриншота",
       "steps": [_s("ExecutionDrawer → Attach File → выбрать PNG","Загружен")],
       "post": "Скриншот привязан."},
      {"name": "Collapsible Suite groups",
       "steps": [_s("Кликнуть заголовок Suite-группы","Свёрнута")],
       "post": "Кейсы скрыты / показаны."},
      {"name": "Фильтрация по статусу",
       "steps": [_s("Фильтр Status=Failed","Применён")],
       "post": "Только Failed кейсы."},
      {"name": "Per-step results",
       "steps": [_s("Отметить чекбокс на каждом шаге","Отмечены")],
       "post": "Passed доступен только если все шаги ✓."},
      {"name": "Actual Result сохраняется",
       "steps": [_s("Ввести текст в Actual Result","Введено"),
                 _s("Закрыть и открыть снова","Открыт")],
       "post": "Actual Result не потерян."},
      {"name": "API-runner в ExecutionDrawer", "layer": "api",
       "steps": [_s("Кейс layer=API → ▶ API","Выполнен")],
       "post": "Все API-шаги выполнены автоматически."},
      {"name": "Inline per-step API runner", "layer": "api",
       "steps": [_s("▶ на конкретном шаге","Запрос выполнен")],
       "post": "Статус и ответ inline."},
      {"name": "Статистика прогона",
       "steps": [_s("Открыть завершённый прогон","Открыт")],
       "post": "total / passed / failed / blocked / untested."},
      {"name": "Completion reminder через неактивность",
       "steps": [_s("Не выполнять действий 30 мин","Ожидание")],
       "post": "Напоминание: «Прогон активен Nм»."},
      {"name": "Прогон можно удалить", "severity": "major",
       "steps": [_s("Удалить прогон → Подтвердить","Удалён")],
       "post": "Прогон и результаты удалены."},
    ],
  },
  {
    "name": "Attachments",
    "desc": "Проверка загрузки и отображения вложений.",
    "cases": [
      {"name": "Загрузка PNG в результат",
       "steps": [_s("ExecutionDrawer → Attach File → PNG","Загружен")],
       "post": "Файл в MinIO. Превью в drawer."},
      {"name": "Загрузка JPEG-скриншота",
       "steps": [_s("Прикрепить JPEG","Загружен")],
       "post": "Превью. Открывается в полном размере."},
      {"name": "Загрузка PDF-документа",
       "steps": [_s("Прикрепить PDF","Загружен")],
       "post": "Ссылка на скачивание."},
      {"name": "Лимит размера файла", "behavior": "negative",
       "steps": [_s("Загрузить файл > 50 МБ","Попытка")],
       "post": "Загрузка отклонена."},
      {"name": "Удаление вложения",
       "steps": [_s("Delete на вложении","Удалено")],
       "post": "Файл удалён из MinIO и списка."},
      {"name": "Несколько вложений к одному результату",
       "steps": [_s("Загрузить 3 файла","Все загружены")],
       "post": "Все 3 в списке."},
      {"name": "Вложения в отчёте",
       "steps": [_s("Создать отчёт с вложениями","Создан")],
       "post": "Скриншоты в секции результатов."},
      {"name": "Скачивание вложения",
       "steps": [_s("Download","Скачан")],
       "post": "Файл скачан без ошибок."},
      {"name": "TXT/CSV-файлы",
       "steps": [_s("Загрузить TXT","Загружен")],
       "post": "Ссылка на скачивание (без превью)."},
      {"name": "MinIO persistent при перезапуске",
       "steps": [_s("Загрузить файл","Загружен"),
                 _s("Перезапустить контейнеры","Перезапущены"),
                 _s("Открыть результат","Открыт")],
       "post": "Файл доступен (volume persistent)."},
    ],
  },
  {
    "name": "Dashboard и Reports",
    "desc": "Проверка аналитики и отчётности.",
    "cases": [
      {"name": "My Dashboard — 4 виджета",
       "steps": [_s("Открыть My Dashboard","Открыт")],
       "post": "Coverage, Recent Runs, Last Activity, Cases by Requirement."},
      {"name": "Workspace Dashboard — EQD",
       "steps": [_s("Открыть Dashboards","Открыт")],
       "post": "EQD donut chart."},
      {"name": "Release Readiness Score (RRS)",
       "steps": [_s("Открыть Dashboards → RRS","Виден")],
       "post": "Спидометр RRS 0–100%."},
      {"name": "Отчёт по выполнению тестов",
       "steps": [_s("Выполнить тесты с разными статусами","Выполнены"),
                 _s("Открыть Reports","Открыт")],
       "post": "Passed/Failed/Blocked. Проценты корректны."},
      {"name": "Экспорт отчёта в DOCX",
       "steps": [_s("Reports → Export DOCX","Скачан")],
       "post": "DOCX с протоколом тестирования."},
      {"name": "Coverage — фильтр по типу",
       "steps": [_s("My Dashboard → Coverage → тип Epic","Фильтр")],
       "post": "Покрытие пересчитано для Epic."},
      {"name": "Last Activity",
       "steps": [_s("My Dashboard → Last Activity","Виджет")],
       "post": "who / when / where / ссылка."},
      {"name": "Печать виджета",
       "steps": [_s("Print на виджете","Инициирована")],
       "post": "Виджет на печать (canvas→PNG)."},
      {"name": "Cases by Requirement",
       "steps": [_s("Открыть виджет → выбрать требование","Выбрано")],
       "post": "Pass Rate и список кейсов."},
      {"name": "Release Defect Profile",
       "steps": [_s("Открыть Dashboards → Release Defect Profile","Виджет")],
       "post": "График дефектов по релизам."},
    ],
  },
]


def bootstrap_demo_project(db: Session) -> None:
    """Создаёт Demo Project + 11 суитов + ~190 кейсов если их ещё нет."""
    import logging
    from sqlalchemy import func as sqlfunc
    from app.models.project import Project
    from app.models.test_suite import TestSuite
    from app.models.test_case import TestCase
    from app.models.enums import (
        Severity, Priority, CaseStatus, CaseType,
        Behavior, Layer, AutomationStatus,
    )

    logger = logging.getLogger("tms-auth")

    # ── 1. Demo Project ───────────────────────────────────────────────────────
    project = db.query(Project).filter(Project.id == _DEMO_PROJECT_ID).first()
    if not project:
        project = Project(
            id=_DEMO_PROJECT_ID,
            name=_DEMO_PROJECT_NAME,
            abbreviation="DEMO",
            description="Demo project for TMS4QA — contains test cases for all TMS features.",
            is_private=False,
            organization_id=_DEMO_ORG_ID,
        )
        db.add(project)
        db.flush()
        logger.info("✅ Demo project created: %s", _DEMO_PROJECT_NAME)
    else:
        logger.info("Demo project already exists: %s", project.name)

    # ── 2. Guard: skip seeding if suites already exist ────────────────────────
    existing_suites = db.query(TestSuite).filter(
        TestSuite.project_id == _DEMO_PROJECT_ID
    ).count()
    if existing_suites > 0:
        logger.info("Demo project already has %d suites — skipping seed", existing_suites)
        db.commit()
        return

    # ── helpers ───────────────────────────────────────────────────────────────
    _sev = {e.value: e for e in Severity}
    _pri = {e.value: e for e in Priority}
    _lay = {e.value: e for e in Layer}
    _beh = {e.value: e for e in Behavior}

    def _next_seq() -> int:
        v = db.query(sqlfunc.max(TestCase.display_seq)).filter(
            TestCase.project_id == _DEMO_PROJECT_ID
        ).scalar()
        return (v or 0) + 1

    def _next_ord(suite_id) -> int:
        v = db.query(sqlfunc.max(TestCase.display_order)).filter(
            TestCase.project_id == _DEMO_PROJECT_ID,
            TestCase.test_suite_id == suite_id,
        ).scalar()
        return (v or 0) + 1

    # ── 3. Create suites + cases ──────────────────────────────────────────────
    total_suites = 0
    total_cases = 0

    for suite_data in _DEMO_SUITES:
        suite = TestSuite(
            name=suite_data["name"],
            description=suite_data.get("desc"),
            project_id=_DEMO_PROJECT_ID,
            parent_id=None,
        )
        db.add(suite)
        db.flush()
        total_suites += 1

        for c in suite_data.get("cases", []):
            severity_val = _sev.get(c.get("severity", "normal"), Severity.normal)
            priority_val = _pri.get(c.get("priority", "medium"), Priority.medium)
            layer_val    = _lay.get(c.get("layer", "not_set"), Layer.not_set)
            behavior_val = _beh.get(c.get("behavior", "positive"), Behavior.positive)

            tc = TestCase(
                name=c["name"],
                description=c.get("desc"),
                pre_conditions=c.get("pre"),
                post_conditions=c.get("post"),
                steps=c.get("steps", []),
                project_id=_DEMO_PROJECT_ID,
                test_suite_id=suite.id,
                severity=severity_val,
                priority=priority_val,
                status=CaseStatus.actual,
                type=CaseType.functional,
                behavior=behavior_val,
                layer=layer_val,
                automation_status=AutomationStatus.manual,
                is_flaky=False,
                muted=False,
                is_deleted=False,
                tags=[],
                labels={},
                revision=1,
                display_seq=_next_seq(),
                display_order=_next_ord(suite.id),
            )
            db.add(tc)
            db.flush()
            total_cases += 1

    db.commit()
    logger.info("✅ Demo project seeded: %d suites, %d cases", total_suites, total_cases)
