# TMS4QA

**TMS4QA** — open-source система управления тестированием (Test Management System) для QA-команд: репозиторий тест-кейсов, тест-планы, прогоны, дефекты, требования и трассируемость в одном веб-приложении, которое разворачивается одной командой через Docker Compose.

> Проект — самостоятельная разработка и не связан с какими-либо коммерческими TMS-продуктами, не является их форком или официальным продуктом.

## Какую задачу решает

Ручное тестирование часто ведётся в таблицах и документах: кейсы теряются, результаты прогонов невозможно сравнить, связь «требование → тест → дефект» не прослеживается. TMS4QA даёт единое место для:

- хранения и версионирования тестовой документации;
- планирования и проведения тестовых прогонов с фиксацией результатов;
- учёта дефектов, привязанных к прогонам и результатам;
- контроля покрытия требований тестами и готовности релиза.

## Основные возможности

- **Репозиторий тест-кейсов** — иерархия сьютов (дерево и folder view), полные атрибуты кейса (шаги, пред-/постусловия, severity, priority, type, layer, behavior, automation status, теги), поиск, массовые операции, Shared Steps, чек-листы, Review.
- **Тест-планы** — статическая выборка кейсов через сьюты, отображаемые ID `R{N}`.
- **Тест-прогоны** — создание из репозитория или плана, автозаполнение результатов, drawer выполнения со статусами, вложения (скриншоты/видео), конфигурации и окружения.
- **Дефекты** — привязка к прогону и результатам, группировка по прогону, экспорт в PDF / XLSX / CSV.
- **Требования и трассируемость** — иерархия Epic → Feature → Story, матрица Requirements ↔ Test Cases, покрытие, ссылки на внешний трекер.
- **Релизы, Milestones, Todo, отчёты и дашборды** (chart.js), оценка готовности релиза.
- **Перенос данных** — экспорт/импорт тест-плана и прогона между инсталляциями (самодостаточный JSON-бандл), полный бэкап проекта, экспорт/импорт сьютов и кейсов в формате Qase JSON для совместимости (Qase — товарный знак своего владельца, проект с ним не связан).
- **Встроенные приложения** — API Check (HTTP-запуск API-кейсов, contract validation, монитор), Report Template Builder, Bulk Import из JSON, кастомизация темы.
- **Пользователи и роли** — JWT-аутентификация, организации, роли (Super Admin, Owner и др.), журнал аудита.

## Архитектура

```
┌──────────────┐   /api (Vite proxy)  ┌──────────────────┐     ┌──────────────┐
│  Frontend    │ ───────────────────▶ │  Backend API     │ ──▶ │ PostgreSQL   │
│ React + Vite │                      │ FastAPI + SQLA   │     └──────────────┘
└──────────────┘                      │ Alembic, JWT     │     ┌──────────────┐
                                      └──────────────────┘ ──▶ │ MinIO (S3)   │
                                                               │ вложения     │
                                                               └──────────────┘
```

Backend построен по модульному принципу: каждый домен (`testcases`, `testruns`, `defects`, …) содержит `router.py` → `service.py` → `repository.py` + Pydantic-схемы `schemas.py`. Миграции БД — Alembic, применяются автоматически при старте контейнера backend.

## Стек

| Слой | Технологии |
|---|---|
| Backend | Python 3.11, FastAPI, SQLAlchemy 2, Pydantic v2, Alembic, psycopg 3, python-jose, bcrypt |
| БД | PostgreSQL 15 |
| Хранилище файлов | MinIO (S3-совместимое) |
| Frontend | React 18, TypeScript, Vite 5, React Router 6, chart.js |
| UI | Без UI-библиотек — чистый CSS на дизайн-токенах |
| Инфраструктура | Docker, Docker Compose |

## Требования

- Docker 24+ и Docker Compose v2 (Docker Desktop на Windows/macOS);
- для запуска без Docker: Python 3.11+, Node.js 20+, PostgreSQL 15, MinIO.

## Быстрый старт (Docker)

```bash
git clone <URL-репозитория> tms4qa
cd tms4qa

cp .env.example .env
# Заполните обязательные значения в .env:
#   POSTGRES_PASSWORD, JWT_SECRET, SUPERADMIN_PASSWORD, MINIO_ROOT_PASSWORD
# Например, секрет можно сгенерировать так: openssl rand -hex 32

docker compose up --build -d
```

Миграции применяются автоматически (`backend/start.sh`), при первом старте создаются Super Admin, демо-организация, демо-владелец и демо-проект.

После запуска (порты по умолчанию, меняются в `.env`):

| Сервис | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API / Swagger UI | http://localhost:8000/docs |
| PostgreSQL | `localhost:5434` |
| MinIO Console | http://localhost:9001 |

Вход: Super Admin — `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` из `.env`; демо-владелец — `owner@demo.local` / `Demo123!` (создаётся автоматически — **смените пароль или удалите пользователя вне локальной среды**).

Полезные команды:

```bash
docker compose logs -f backend                 # логи backend
docker compose exec backend alembic upgrade head   # применить миграции вручную
docker compose down                            # остановить
docker compose down -v                         # остановить и удалить данные (тома)
```

### Несколько копий на одной машине

Все порты и имя compose-проекта задаются в `.env` (`COMPOSE_PROJECT_NAME`, `FRONTEND_PORT`, `BACKEND_PORT`, `POSTGRES_PORT`, `MINIO_API_PORT`, `MINIO_CONSOLE_PORT`). Достаточно скопировать репозиторий в другую папку и указать другие значения — стеки не будут конфликтовать.

## Настройка `.env`

| Переменная | Обязательна | Описание |
|---|---|---|
| `COMPOSE_PROJECT_NAME` | нет | Префикс контейнеров и томов |
| `TZ` | нет | Часовой пояс контейнеров (по умолчанию `UTC`) |
| `*_PORT` | нет | Порты на хосте |
| `POSTGRES_USER`, `POSTGRES_DB` | нет | Пользователь и имя БД |
| `POSTGRES_PASSWORD` | **да** | Пароль БД |
| `JWT_SECRET` | **да** | Секрет подписи JWT |
| `ACCESS_TOKEN_EXPIRE_MINUTES`, `REFRESH_TOKEN_EXPIRE_DAYS` | нет | Время жизни токенов |
| `SUPERADMIN_EMAIL` | нет | Логин супер-администратора |
| `SUPERADMIN_PASSWORD` | **да** | Пароль супер-администратора |
| `MINIO_ROOT_USER`, `MINIO_BUCKET` | нет | Учётка и бакет MinIO |
| `MINIO_ROOT_PASSWORD` | **да** | Пароль MinIO (≥ 8 символов) |

## Запуск без Docker

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # укажите DATABASE_URL, JWT_SECRET, MinIO и т.д.
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
# адрес backend для Vite-прокси /api
VITE_API_URL=http://localhost:8000 npm run dev
```

Frontend будет доступен на http://localhost:5173. Продакшен-сборка: `npm run build` (результат в `frontend/dist`).

## Тесты

Автоматизированных тестов в репозитории пока нет. Минимальная проверка:

```bash
# проверка типов frontend
cd frontend && npx tsc --noEmit

# healthcheck backend
curl http://localhost:8000/health
```

## API

- Swagger UI: `http://localhost:8000/docs` (ассеты Swagger UI раздаются локально из `backend/app/static`).
- OpenAPI-схема: `http://localhost:8000/openapi.json`.
- Все доменные эндпоинты — под `/api/v1` (projects, testsuites, testcases, testplans, testruns, defects, requirements, releases, shared steps, checklists, todos, attachments, audit, transfer), аутентификация — `POST /api/auth/login`.
- Для запросов из Swagger: выполните `POST /api/auth/login`, скопируйте `access_token` и вставьте его в **Authorize**.

## Структура проекта

```
.
├── docker-compose.yml        # db + backend + minio + frontend
├── .env.example              # шаблон переменных окружения
├── backend/
│   ├── Dockerfile, start.sh  # образ и запуск (миграции + uvicorn)
│   ├── requirements.txt
│   ├── alembic/              # миграции БД
│   └── app/
│       ├── main.py           # FastAPI-приложение и роутеры
│       ├── core/             # конфиг, безопасность (JWT/RBAC), MinIO-клиент
│       ├── db/               # базовая модель, сессия
│       ├── models/           # SQLAlchemy-модели и enum'ы
│       ├── modules/<domain>/ # router / service / repository / schemas
│       ├── scripts/          # служебные скрипты (миграция вложений в MinIO)
│       └── static/           # Swagger UI (сторонний код, Apache-2.0)
└── frontend/
    ├── Dockerfile, vite.config.ts, package.json
    └── src/
        ├── api/client.ts     # HTTP-клиент и типы API
        ├── components/       # переиспользуемые компоненты
        ├── layouts/, pages/  # страницы приложения
        ├── hooks/, utils/, constants/
        └── styles/           # дизайн-токены и глобальные стили
```

## Безопасность

- Не коммитьте `.env` и реальные секреты — они исключены через `.gitignore`.
- `JWT_SECRET` обязателен: без него backend не запустится. Запросы без токена всегда отклоняются (401).
- Демо-учётки и стартовые пароли предназначены только для локальной разработки.

## Лицензия

License: Apache License 2.0 — см. файл [LICENSE](LICENSE) и [NOTICE](NOTICE).
Сведения о лицензиях сторонних зависимостей — [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## Авторство

Copyright 2026 Mariya Glazkova

Проект разработан автором; при разработке использовались AI-инструменты для генерации и доработки кода по требованиям автора.
