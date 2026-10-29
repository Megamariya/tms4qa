# Third-Party Licenses

TMS4QA распространяется под Apache License 2.0 (см. [LICENSE](LICENSE)).
Ниже перечислены существенные сторонние компоненты, которые проект использует.
Зависимости, устанавливаемые через `pip` / `npm`, **не входят** в репозиторий —
они скачиваются при сборке и распространяются под собственными лицензиями.

## Включено в репозиторий (redistributed)

| Компонент | Путь | Лицензия | Требования |
|---|---|---|---|
| Swagger UI | `backend/app/static/swagger-ui-bundle.js`, `swagger-ui.css` | Apache-2.0 (© SmartBear Software) | Сохранять уведомления об авторстве — указано в [NOTICE](NOTICE) |

## Backend (Python, `backend/requirements.txt`)

| Пакет | Лицензия |
|---|---|
| fastapi | MIT |
| starlette (через fastapi) | BSD-3-Clause |
| pydantic (через fastapi) | MIT |
| uvicorn | BSD-3-Clause |
| SQLAlchemy | MIT |
| alembic | MIT |
| psycopg (v3, `psycopg[binary]`) | LGPL-3.0-only |
| python-dotenv | BSD-3-Clause |
| python-jose | MIT |
| cryptography (через python-jose) | Apache-2.0 OR BSD-3-Clause |
| bcrypt | Apache-2.0 |
| minio (Python SDK) | Apache-2.0 |
| python-multipart | Apache-2.0 |

**LGPL (psycopg):** библиотека используется как немодифицированная
динамически подключаемая зависимость, устанавливаемые пользователем через pip.
Это совместимо с распространением собственного кода под Apache-2.0; при
распространении готовых Docker-образов с этими библиотеками следует сохранять
их лицензии (pip устанавливает их вместе с пакетами).

## Frontend (npm, `frontend/package.json`)

| Пакет | Лицензия |
|---|---|
| react, react-dom | MIT |
| react-router-dom | MIT |
| chart.js | MIT |
| react-chartjs-2 | MIT |
| vite *(dev)* | MIT |
| @vitejs/plugin-react *(dev)* | MIT |
| typescript *(dev)* | Apache-2.0 |
| @types/react, @types/react-dom *(dev)* | MIT |

## Сервисы Docker Compose (отдельные образы, не входят в репозиторий)

| Образ | Лицензия | Примечание |
|---|---|---|
| postgres:15 | PostgreSQL License | — |
| pgsty/minio:RELEASE.2026-08-04T00-00-00Z (сборка MinIO от Pigsty) | **AGPL-3.0** | Используется как отдельный немодифицированный сервис по сети (S3 API). Код TMS4QA не включает и не модифицирует MinIO. При модификации MinIO или предоставлении его как сервиса третьим лицам — соблюдайте условия AGPL-3.0. |
| python:3.11, node:20-alpine | PSF / MIT и др. | Базовые образы сборки |

Лицензии указаны по данным пакетов на момент подготовки репозитория; перед
коммерческим распространением рекомендуется перепроверить их актуальность
(например, `pip-licenses` и `npx license-checker`).
