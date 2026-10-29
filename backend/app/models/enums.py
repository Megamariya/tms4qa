"""Перечисления, общие для нескольких моделей TMS.

Значения — стабильные строковые коды, чтобы фронт мог рендерить бейджи без перевода.
"""

import enum


class Severity(str, enum.Enum):
    blocker = "blocker"
    critical = "critical"
    major = "major"
    normal = "normal"
    minor = "minor"
    trivial = "trivial"


class Priority(str, enum.Enum):
    high = "high"
    medium = "medium"
    low = "low"
    not_set = "not_set"


class CaseStatus(str, enum.Enum):
    actual = "actual"
    draft = "draft"
    deprecated = "deprecated"
    review = "review"


class PlanStatus(str, enum.Enum):
    active = "active"
    review = "review"
    archived = "archived"


class CaseType(str, enum.Enum):
    functional = "functional"
    smoke = "smoke"
    regression = "regression"
    security = "security"
    performance = "performance"
    usability = "usability"
    acceptance = "acceptance"
    other = "other"


class Behavior(str, enum.Enum):
    positive = "positive"
    negative = "negative"
    destructive = "destructive"
    not_set = "not_set"


class Layer(str, enum.Enum):
    unit = "unit"
    integration = "integration"
    e2e = "e2e"
    api = "api"
    ui = "ui"
    not_set = "not_set"


class AutomationStatus(str, enum.Enum):
    manual = "manual"
    to_be_automated = "to_be_automated"
    automated = "automated"


class RunStatus(str, enum.Enum):
    ready_to_start = "ready_to_start"
    in_progress = "in_progress"
    on_hold = "on_hold"
    completed = "completed"
    aborted = "aborted"


class ResultStatus(str, enum.Enum):
    untested = "untested"
    passed = "passed"
    failed = "failed"
    blocked = "blocked"
    skipped = "skipped"
    invalid = "invalid"
    retest = "retest"
    in_progress = "in_progress"


class DefectStatus(str, enum.Enum):
    open = "open"
    in_progress = "in_progress"
    resolved = "resolved"
    closed = "closed"
    reopened = "reopened"


class UserRole(str, enum.Enum):
    SUPER_ADMIN = "SUPER_ADMIN"
    OWNER = "OWNER"
    PM = "PM"
    QA_LEAD = "QA_LEAD"
    TESTER = "TESTER"
    ANALYST = "ANALYST"
    DEVELOPER = "DEVELOPER"
    CTO = "CTO"
