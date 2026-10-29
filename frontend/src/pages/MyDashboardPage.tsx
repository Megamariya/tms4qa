import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  requirementsApi, runsApi, casesApi,
  type TestRun, type ReqTrace, type TestCase, type Requirement,
} from "../api/client";
import "./MyDashboardPage.css";

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_WIDGETS = [
  { id: "coverage",    label: "Test Coverage by Requirements" },
  { id: "runs",        label: "Последние тестовые прогоны" },
  { id: "changes",     label: "Last Activity" },
  { id: "case_by_req", label: "Распределение кейсов по требованию" },
] as const;

const MYD_REQ_ICONS: Record<string, string> = { epic: "🗺", feature: "✨", story: "📖", requirement: "📋" };

type WidgetId = (typeof ALL_WIDGETS)[number]["id"];

const CFG_KEY = (pid: string) => `myd_widgets_${pid}`;

function loadVisible(pid: string): Set<WidgetId> {
  try {
    const raw = localStorage.getItem(CFG_KEY(pid));
    if (raw) return new Set(JSON.parse(raw) as WidgetId[]);
  } catch { /* noop */ }
  return new Set(ALL_WIDGETS.map((w) => w.id));
}

function saveVisible(pid: string, ids: Set<WidgetId>) {
  localStorage.setItem(CFG_KEY(pid), JSON.stringify([...ids]));
}

// ── Run status colors ─────────────────────────────────────────────────────────

const RUN_STATUS_META: Record<string, { label: string; bg: string; color: string }> = {
  ready_to_start: { label: "Ready",       bg: "#f3f4f6", color: "#374151" },
  in_progress:    { label: "In Progress", bg: "#dbeafe", color: "#1d4ed8" },
  on_hold:        { label: "On Hold",     bg: "#fef3c7", color: "#92400e" },
  completed:      { label: "Completed",   bg: "#dcfce7", color: "#15803d" },
  aborted:        { label: "Aborted",     bg: "#fee2e2", color: "#dc2626" },
};

// ── Requirement type labels ───────────────────────────────────────────────────

const REQ_TYPE_LABELS: Record<string, string> = {
  epic:        "Epic",
  feature:     "Feature",
  story:       "Story",
  requirement: "Requirement",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " + d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

function collectPageStyles() {
  const parts: string[] = [];
  document.querySelectorAll("style").forEach((s) => { if (s.textContent) parts.push(s.textContent); });
  return parts.join("\n");
}

function widgetToHtml(el: HTMLDivElement, title: string): string {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("[data-widget-actions]").forEach((n) => n.remove());
  const styles = collectPageStyles();
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>${title}</title>
<style>${styles}</style></head><body style="padding:24px">${clone.outerHTML}</body></html>`;
}

// ── Widget Help Tooltip ───────────────────────────────────────────────────────

function WidgetHelp({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: "relative", display: "inline-flex" }}>
      <button
        className="myd-widget-btn"
        title="Справка"
        onClick={() => setOpen((v) => !v)}
        style={{ fontWeight: 700, fontSize: 12 }}
        data-widget-actions
      >
        ℹ
      </button>
      {open && (
        <div
          style={{
            position: "absolute", right: 0, top: "calc(100% + 6px)", width: 240,
            background: "var(--color-bg)", border: "1px solid var(--color-border)",
            borderRadius: 8, padding: "10px 12px", boxShadow: "0 6px 20px rgba(0,0,0,.14)",
            zIndex: 100, fontSize: 12, lineHeight: 1.5, color: "var(--color-text)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {text}
          <button
            style={{ display: "block", marginTop: 8, fontSize: 11, cursor: "pointer", color: "var(--color-accent)", background: "none", border: "none" }}
            onClick={() => setOpen(false)}
          >
            Закрыть
          </button>
        </div>
      )}
    </div>
  );
}

// ── Widget Actions (export/print + help) ─────────────────────────────────────

function WidgetActions({
  widgetRef, title, helpText,
}: {
  widgetRef: React.RefObject<HTMLDivElement>;
  title: string;
  helpText: string;
}) {
  const exportWidget = () => {
    if (!widgetRef.current) return;
    const html = widgetToHtml(widgetRef.current, title);
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); }
  };
  const printWidget = () => {
    if (!widgetRef.current) return;
    const html = widgetToHtml(widgetRef.current, title);
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 400); }
  };
  return (
    <div style={{ display: "flex", gap: 4 }} data-widget-actions>
      <button className="myd-widget-btn" title="Экспорт" onClick={exportWidget}>⬇</button>
      <button className="myd-widget-btn" title="Печать"  onClick={printWidget}>⎙</button>
      <WidgetHelp text={helpText} />
    </div>
  );
}

// ── Widget: Test Coverage by Requirements ─────────────────────────────────────

const COVERAGE_HELP = `Coverage = (Требований с хотя бы одним тест-кейсом / Всего требований) × 100%.
Фильтр по типу: Epic / Feature / Story / Requirement.
Поиск — по названию требования.
Разбивка P/F/B/U — суммарные статусы по всем привязанным тест-кейсам.`;

type CovFilterType = "all" | "epic" | "feature" | "story" | "requirement";

function getDescendantIds(epicId: string, trace: ReqTrace[]): Set<string> {
  const result = new Set<string>([epicId]);
  const queue = [epicId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const r of trace) {
      if (r.parent_id === current && !result.has(r.id)) {
        result.add(r.id);
        queue.push(r.id);
      }
    }
  }
  return result;
}

function CoverageWidget({ projectId }: { projectId: string }) {
  const [trace, setTrace]         = useState<ReqTrace[]>([]);
  const [loading, setLoading]     = useState(true);
  const [filterType, setFilterType] = useState<CovFilterType>("all");
  const [search, setSearch]       = useState("");
  const [selectedEpicId, setSelectedEpicId] = useState("");
  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    requirementsApi.traceability(projectId)
      .then(setTrace).catch(() => {}).finally(() => setLoading(false));
  }, [projectId]);

  const epics = useMemo(() => trace.filter((r) => r.req_type === "epic"), [trace]);

  const epicDescendants = useMemo(
    () => selectedEpicId ? getDescendantIds(selectedEpicId, trace) : null,
    [selectedEpicId, trace]
  );

  const view = trace.filter((r) => {
    if (epicDescendants && !epicDescendants.has(r.id)) return false;
    if (filterType !== "all" && r.req_type !== filterType) return false;
    if (search.trim() && !r.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const total    = view.length;
  const covered  = view.filter((r) => r.total_cases > 0).length;
  const pct      = total > 0 ? Math.round((covered / total) * 100) : 0;
  const passed   = view.reduce((s, r) => s + r.passed,   0);
  const failed   = view.reduce((s, r) => s + r.failed,   0);
  const blocked  = view.reduce((s, r) => s + r.blocked,  0);
  const untested = view.reduce((s, r) => s + r.untested, 0);

  return (
    <div className="myd-widget" ref={widgetRef}>
      <div className="myd-widget-head">
        <span className="myd-widget-title">📊 Test Coverage by Requirements</span>
        <WidgetActions widgetRef={widgetRef} title="Test Coverage by Requirements" helpText={COVERAGE_HELP} />
      </div>

      {/* Filters */}
      <div style={{ padding: "8px 14px 0", display: "flex", gap: 6, flexWrap: "wrap", borderBottom: "1px solid var(--color-border)" }}>
        {epics.length > 0 && (
          <select
            className="input"
            style={{ fontSize: 11, height: 26, padding: "2px 6px", minWidth: 130 }}
            value={selectedEpicId}
            onChange={(e) => { setSelectedEpicId(e.target.value); setFilterType("all"); }}
          >
            <option value="">— Все Epics —</option>
            {epics.map((e) => (
              <option key={e.id} value={e.id}>{e.title}</option>
            ))}
          </select>
        )}
        <select
          className="input"
          style={{ fontSize: 11, height: 26, padding: "2px 6px", minWidth: 110 }}
          value={filterType}
          onChange={(e) => setFilterType(e.target.value as CovFilterType)}
        >
          <option value="all">Все типы</option>
          <option value="epic">Epic</option>
          <option value="feature">Feature</option>
          <option value="story">Story</option>
          <option value="requirement">Requirement</option>
        </select>
        <input
          className="input"
          style={{ fontSize: 11, height: 26, padding: "2px 8px", flex: 1, minWidth: 100 }}
          placeholder="Поиск по названию…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="myd-empty-widget">Загружаем…</div>
      ) : total === 0 ? (
        <div className="myd-empty-widget">{trace.length === 0 ? "Нет требований" : "Ничего не найдено"}</div>
      ) : (
        <div className="myd-widget-body">
          <div className="myd-cov-num">{pct}%</div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 4 }}>
            {selectedEpicId && <span style={{ marginRight: 6, fontWeight: 600, color: "var(--color-accent)" }}>🗺 {epics.find((e) => e.id === selectedEpicId)?.title}</span>}
            {filterType !== "all" && <span style={{ marginRight: 6, fontWeight: 600, color: "var(--color-accent)" }}>{REQ_TYPE_LABELS[filterType] ?? filterType}</span>}
            Coverage: {covered} / {total} требований покрыто
          </div>
          <div className="myd-cov-bar-wrap">
            <div className="myd-cov-bar-fill" style={{ width: `${pct}%` }} />
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
            {[
              { label: "Passed",   val: passed,   color: "var(--color-passed)" },
              { label: "Failed",   val: failed,   color: "var(--color-failed)" },
              { label: "Blocked",  val: blocked,  color: "var(--color-blocked)" },
              { label: "Untested", val: untested, color: "var(--color-text-muted)" },
            ].map((s) => (
              <div key={s.label} style={{ fontSize: 11, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                <span style={{ fontWeight: 700, fontSize: 16, color: s.color }}>{s.val}</span>
                <span style={{ color: "var(--color-text-muted)" }}>{s.label}</span>
              </div>
            ))}
          </div>
          {/* Per-requirement list — shows names when filtering/searching */}
          <div style={{ marginTop: 10, borderTop: "1px solid var(--color-border)", paddingTop: 8, maxHeight: 200, overflowY: "auto" }}>
            {view.length === 0 && search && (
              <div style={{ fontSize: 11, color: "var(--color-text-muted)", padding: "4px 0" }}>Ничего не найдено</div>
            )}
            {view.map((r) => (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 5, padding: "3px 0", borderBottom: "1px solid var(--color-border)", fontSize: 11 }}>
                <span style={{ flexShrink: 0 }}>{MYD_REQ_ICONS[r.req_type ?? "requirement"] ?? "📋"}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text)" }}>{r.title}</span>
                <span style={{ flexShrink: 0, color: "var(--color-text-muted)", fontSize: 10 }}>{r.total_cases} кейсов</span>
                <span style={{ flexShrink: 0, fontWeight: 600, fontSize: 10,
                  color: r.coverage_pct >= 100 ? "#16a34a" : r.coverage_pct > 0 ? "#ca8a04" : "var(--color-text-muted)"
                }}>{Math.round(r.coverage_pct)}%</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Widget: Last 5 Test Runs ──────────────────────────────────────────────────

const RUNS_HELP = `Показывает 5 последних тестовых прогонов проекта, отсортированных по дате создания.
Отображает: название, окружение, исполнитель, статус, время.
Клик по строке → страница прогона.`;

function RecentRunsWidget({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [runs, setRuns]     = useState<TestRun[]>([]);
  const [loading, setLoading] = useState(true);
  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    runsApi.list(projectId)
      .then((rs) => setRuns([...rs].sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 5)))
      .catch(() => {}).finally(() => setLoading(false));
  }, [projectId]);

  return (
    <div className="myd-widget" ref={widgetRef}>
      <div className="myd-widget-head">
        <span className="myd-widget-title">▶ Последние тестовые прогоны</span>
        <WidgetActions widgetRef={widgetRef} title="Последние тестовые прогоны" helpText={RUNS_HELP} />
      </div>
      {loading ? (
        <div className="myd-empty-widget">Загружаем…</div>
      ) : runs.length === 0 ? (
        <div className="myd-empty-widget">Нет прогонов</div>
      ) : (
        <div className="myd-widget-body" style={{ padding: "8px 16px" }}>
          {runs.map((r) => {
            const sm = RUN_STATUS_META[r.status] ?? { label: r.status, bg: "#f3f4f6", color: "#374151" };
            return (
              <div key={r.id} className="myd-run-row" style={{ cursor: "pointer" }}
                onClick={() => navigate(`/project/${projectId}/run/${r.id}`)}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="myd-run-name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                  <div className="myd-run-meta">
                    {r.environment && <span style={{ marginRight: 6 }}>🌐 {r.environment}</span>}
                    {r.started_by_name
                      ? <span style={{ marginRight: 6 }}>👤 {r.started_by_name}</span>
                      : <span style={{ marginRight: 6, color: "var(--color-text-muted)" }}>👤 Demo User</span>}
                    <span>🕐 {fmtDate(r.started_at)}</span>
                  </div>
                </div>
                <span className="myd-run-status" style={{ background: sm.bg, color: sm.color }}>{sm.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Widget: Last Activity ─────────────────────────────────────────────────────

const ACTIVITY_HELP = `Показывает 8 последних изменений в тест-дизайне и аналитике требований.
• Кто — исполнитель изменения (текущий пользователь системы).
• Когда — дата и время последнего обновления.
• Где — тип объекта (тест-кейс / требование) и раздел.
• Просмотр — кнопка «→» переходит к объекту.`;

type ActivityEntry = {
  id: string;
  kind: "case" | "req";
  name: string;
  sub: string;       // req_type or "Test Case"
  time: string;
  who: string;
  section: string;   // where (page path label)
};

function LastActivityWidget({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const widgetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      casesApi.list(projectId).catch(() => [] as TestCase[]),
      requirementsApi.list(projectId).catch(() => []),
    ]).then(([cases, reqs]) => {
      const caseEntries: ActivityEntry[] = [...cases]
        .sort((a, b) => (b.updated_at ?? b.created_at ?? "").localeCompare(a.updated_at ?? a.created_at ?? ""))
        .slice(0, 6)
        .map((c) => ({
          id: c.id, kind: "case",
          name: c.name,
          sub: "Test Case",
          time: c.updated_at ?? c.created_at ?? "",
          who: "Demo User",
          section: "Test Cases",
        }));
      const reqEntries: ActivityEntry[] = [...reqs]
        .sort((a, b) => (b.updated_at ?? b.created_at ?? "").localeCompare(a.updated_at ?? a.created_at ?? ""))
        .slice(0, 6)
        .map((r) => ({
          id: r.id, kind: "req",
          name: r.title,
          sub: REQ_TYPE_LABELS[r.req_type ?? "requirement"] ?? "Requirement",
          time: r.updated_at ?? r.created_at ?? "",
          who: "Demo User",
          section: "Requirements",
        }));
      const all = [...caseEntries, ...reqEntries]
        .sort((a, b) => b.time.localeCompare(a.time))
        .slice(0, 8);
      setEntries(all);
    }).finally(() => setLoading(false));
  }, [projectId]);

  const goToItem = (e: ActivityEntry) => {
    if (e.kind === "case") navigate(`/project/${projectId}/repository`);
    else navigate(`/project/${projectId}/traceability`);
  };

  return (
    <div className="myd-widget" ref={widgetRef}>
      <div className="myd-widget-head">
        <span className="myd-widget-title">🕐 Last Activity</span>
        <WidgetActions widgetRef={widgetRef} title="Last Activity" helpText={ACTIVITY_HELP} />
      </div>
      {loading ? (
        <div className="myd-empty-widget">Загружаем…</div>
      ) : entries.length === 0 ? (
        <div className="myd-empty-widget">Нет изменений</div>
      ) : (
        <div className="myd-widget-body" style={{ padding: "0 0" }}>
          {entries.map((e) => (
            <div key={e.id + e.kind} className="myd-activity-row">
              {/* Icon */}
              <div
                className="myd-change-icon"
                style={{
                  background: e.kind === "case" ? "var(--color-accent-soft)" : "#f0fdf4",
                  color: e.kind === "case" ? "var(--color-accent)" : "#15803d",
                  fontWeight: 700, fontSize: 10,
                }}
              >
                {e.kind === "case" ? "TC" : "R"}
              </div>
              {/* Info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {e.name}
                </div>
                <div style={{ fontSize: 11, color: "var(--color-text-muted)", display: "flex", gap: 8, marginTop: 2, flexWrap: "wrap" }}>
                  <span title="Тип">📁 {e.sub}</span>
                  <span title="Раздел">🗂 {e.section}</span>
                  <span title="Кто изменил">👤 {e.who}</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 1 }}>
                  🕐 {e.time ? fmtDate(e.time) : "—"}
                </div>
              </div>
              {/* View button */}
              <button
                className="myd-widget-btn"
                title="Перейти к объекту"
                onClick={() => goToItem(e)}
                style={{ flexShrink: 0 }}
              >
                →
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Widget: Cases by Requirement ─────────────────────────────────────────────

const CASESBYREQ_HELP = `Выберите требование (epic/feature/story/requirement) и посмотрите сколько тест-кейсов к нему привязано, а также их статусы по последнему прогону.`;

function CasesByReqMydWidget({ projectId }: { projectId: string }) {
  const widgetRef = useRef<HTMLDivElement>(null);
  const [reqs, setReqs] = useState<Requirement[]>([]);
  const [search, setSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [cases, setCases] = useState<TestCase[]>([]);
  const [resultMap, setResultMap] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [listExpanded, setListExpanded] = useState(false);

  useEffect(() => {
    requirementsApi.list(projectId).then(setReqs).catch(() => {});
  }, [projectId]);

  useEffect(() => {
    if (!selectedId) { setCases([]); setResultMap(new Map()); return; }
    setLoading(true);
    Promise.all([
      requirementsApi.getTestCases(selectedId),
      runsApi.list(projectId).then(async (runs) => {
        if (runs.length === 0) return new Map<string, string>();
        const latest = [...runs].sort((a, b) =>
          new Date(b.created_at ?? "").getTime() - new Date(a.created_at ?? "").getTime()
        )[0];
        const results = await runsApi.results(latest.id);
        return new Map(results.map((r) => [r.test_case_id, r.status]));
      }),
    ])
      .then(([cs, map]) => { setCases(cs); setResultMap(map); setListExpanded(false); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedId, projectId]);

  const filteredReqs = useMemo(() => {
    if (!search) return reqs;
    const q = search.toLowerCase();
    return reqs.filter((r) => r.title.toLowerCase().includes(q) || (r.req_type ?? "").includes(q));
  }, [reqs, search]);

  const stats = useMemo(() => {
    const s = { total: cases.length, passed: 0, failed: 0, blocked: 0, untested: 0, skipped: 0 };
    for (const c of cases) {
      const st = resultMap.get(c.id) ?? "untested";
      if (st === "passed") s.passed++;
      else if (st === "failed") s.failed++;
      else if (st === "blocked") s.blocked++;
      else if (st === "skipped") s.skipped++;
      else s.untested++;
    }
    return s;
  }, [cases, resultMap]);

  const selectedReq = reqs.find((r) => r.id === selectedId);
  const passRate = stats.total > 0 ? Math.round((stats.passed / stats.total) * 100) : 0;

  const selectReq = (r: Requirement) => { setSelectedId(r.id); setSearch(r.title); setShowDropdown(false); };

  return (
    <div className="myd-widget" ref={widgetRef}>
      <div className="myd-widget-head">
        <span className="myd-widget-title">📊 Кейсы по требованию</span>
        <WidgetActions widgetRef={widgetRef} title="Кейсы по требованию" helpText={CASESBYREQ_HELP} />
      </div>

      <div style={{ padding: "8px 14px 4px", position: "relative" }}>
        <input
          className="input"
          style={{ width: "100%", fontSize: 12 }}
          placeholder="Поиск по названию требования…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setShowDropdown(true); if (!e.target.value) setSelectedId(""); }}
          onFocus={() => setShowDropdown(true)}
          onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
        />
        {showDropdown && filteredReqs.length > 0 && (
          <div style={{
            position: "absolute", top: "calc(100% - 4px)", left: 14, right: 14, zIndex: 20,
            background: "var(--color-bg)", border: "1px solid var(--color-border)",
            borderRadius: "var(--radius-sm)", maxHeight: 200, overflowY: "auto",
            boxShadow: "0 4px 12px rgba(0,0,0,.14)",
          }}>
            {filteredReqs.slice(0, 25).map((r) => (
              <div key={r.id} style={{
                padding: "6px 10px", cursor: "pointer", fontSize: 12,
                borderBottom: "1px solid var(--color-border)",
                background: r.id === selectedId ? "var(--color-bg-soft)" : "transparent",
                display: "flex", alignItems: "center", gap: 6,
              }}
                onMouseDown={() => selectReq(r)}
              >
                <span style={{ flexShrink: 0 }}>{MYD_REQ_ICONS[r.req_type ?? "requirement"] ?? "📋"}</span>
                <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: r.id === selectedId ? 600 : 400 }}>
                  {r.title}
                </span>
                {r.req_type && <span style={{ fontSize: 10, color: "var(--color-text-muted)", flexShrink: 0 }}>{r.req_type}</span>}
                {r.case_count > 0 && <span style={{ fontSize: 10, color: "var(--color-accent)", flexShrink: 0 }}>{r.case_count}</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      {loading && <div className="myd-empty-widget">Загружаем…</div>}
      {!loading && selectedId && cases.length === 0 && (
        <div className="myd-empty-widget">Нет привязанных тест-кейсов</div>
      )}
      {!loading && selectedId && cases.length > 0 && (
        <div className="myd-widget-body" style={{ padding: "6px 16px 12px" }}>
          {selectedReq && (
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-accent)", marginBottom: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {MYD_REQ_ICONS[selectedReq.req_type ?? "requirement"]} {selectedReq.title}
            </div>
          )}
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--color-text-muted)", marginBottom: 3 }}>
              <span>Pass Rate</span>
              <span style={{ fontWeight: 700, color: passRate >= 80 ? "#16a34a" : passRate >= 50 ? "#ca8a04" : "#dc2626" }}>{passRate}%</span>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: "var(--color-border)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${passRate}%`, background: passRate >= 80 ? "#16a34a" : passRate >= 50 ? "#ca8a04" : "#dc2626", transition: "width 0.3s" }} />
            </div>
          </div>
          {[
            { label: "Total", value: stats.total, color: "var(--color-text)" },
            { label: "Passed", value: stats.passed, color: "var(--color-passed)" },
            { label: "Failed", value: stats.failed, color: "var(--color-failed)" },
            { label: "Blocked", value: stats.blocked, color: "var(--color-blocked)" },
            { label: "Untested", value: stats.untested + stats.skipped, color: "var(--color-text-muted)" },
          ].map(({ label, value, color }) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderBottom: "1px solid var(--color-border)", fontSize: 12 }}>
              <span style={{ color: "var(--color-text-muted)" }}>{label}</span>
              <span style={{ fontWeight: 700, color }}>{value}</span>
            </div>
          ))}
          <button className="btn" style={{ marginTop: 8, fontSize: 11, width: "100%" }}
            onClick={() => setListExpanded((v) => !v)}>
            {listExpanded ? "▲ Скрыть кейсы" : `▼ Показать кейсы (${cases.length})`}
          </button>
          {listExpanded && (
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3, maxHeight: 200, overflowY: "auto" }}>
              {cases.map((c) => {
                const status = resultMap.get(c.id) ?? "untested";
                const COL: Record<string, string> = { passed: "#16a34a", failed: "#dc2626", blocked: "#ca8a04", skipped: "#6b7280", untested: "var(--color-text-muted)" };
                const ICO: Record<string, string> = { passed: "✓", failed: "✕", blocked: "⊗", skipped: "⊘", untested: "○" };
                return (
                  <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
                    <span style={{ color: COL[status] ?? COL.untested, flexShrink: 0, fontWeight: 700 }}>{ICO[status] ?? "○"}</span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Configure panel ───────────────────────────────────────────────────────────

function ConfigurePanel({
  visible, onToggle, onClose,
}: {
  visible: Set<WidgetId>;
  onToggle: (id: WidgetId) => void;
  onClose: () => void;
}) {
  return (
    <div className="myd-cfg-overlay" onClick={onClose}>
      <div className="myd-cfg-panel" onClick={(e) => e.stopPropagation()}>
        <div className="myd-cfg-head">
          <h3>Виджеты дашборда</h3>
          <button className="btn btn-secondary" style={{ padding: "2px 8px", fontSize: 11 }} onClick={onClose}>✕</button>
        </div>
        <div className="myd-cfg-body">
          <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: "0 0 12px" }}>
            Включите или выключите виджеты на вашем персональном дашборде.
          </p>
          {ALL_WIDGETS.map((w) => (
            <div key={w.id} className="myd-cfg-item">
              <label>{w.label}</label>
              <label className="myd-toggle">
                <input type="checkbox" checked={visible.has(w.id)} onChange={() => onToggle(w.id)} />
                <span className="myd-toggle-track" />
              </label>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MyDashboardPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const pid = projectId ?? "";

  const [visible, setVisible] = useState<Set<WidgetId>>(() => loadVisible(pid));
  const [cfgOpen, setCfgOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const toggleWidget = (id: WidgetId) => {
    setVisible((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveVisible(pid, next);
      return next;
    });
  };

  const gridRef = useRef<HTMLDivElement>(null);

  const exportAll = () => {
    const grid = gridRef.current;
    if (!grid) return;
    const clone = grid.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("[data-widget-actions]").forEach((n) => n.remove());
    clone.querySelectorAll(".myd-widget-btn").forEach((n) => n.remove());
    clone.querySelectorAll(".myd-widget-actions").forEach((n) => n.remove());
    // Convert canvas to img for charts
    grid.querySelectorAll("canvas").forEach((canvas, i) => {
      const img = clone.querySelectorAll("canvas")[i];
      if (img && img.parentNode) {
        const imgEl = document.createElement("img");
        imgEl.src = canvas.toDataURL("image/png");
        imgEl.style.cssText = `width:${canvas.offsetWidth}px;height:${canvas.offsetHeight}px`;
        img.parentNode.replaceChild(imgEl, img);
      }
    });
    const styles = collectPageStyles();
    const html = `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><title>My Dashboard — Export</title>
<style>
${styles}
body { padding: 28px; background: #fff; color: #1f2937; }
.myd-grid { display: grid; gap: 20px; grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); }
.myd-widget { break-inside: avoid; page-break-inside: avoid; }
@media print { * { -webkit-print-color-adjust: exact; color-adjust: exact; } @page { margin: 12mm; } }
</style>
</head><body>
<h1 style="font-size:18px;font-weight:700;margin:0 0 4px">My Dashboard</h1>
<p style="font-size:12px;color:#6b7280;margin:0 0 20px">Экспорт: ${new Date().toLocaleString("ru-RU")}</p>
${clone.outerHTML}
</body></html>`;
    const w = window.open("", "_blank");
    if (w) { w.document.write(html); w.document.close(); setTimeout(() => w.print(), 500); }
  };

  const shareUrl = window.location.href;

  return (
    <div className="myd-page">
      <div className="myd-header">
        <h1 className="myd-title">My Dashboard</h1>
        <div className="myd-header-actions">
          <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => setShareOpen((v) => !v)}>
            🔗 Поделиться
          </button>
          <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={exportAll}>
            ⬇ Export
          </button>
          <button className="btn btn-secondary" style={{ fontSize: 12 }} onClick={() => setCfgOpen(true)}>
            ⚙ Настроить
          </button>
        </div>
      </div>

      {shareOpen && (
        <div style={{ padding: "8px 24px", background: "var(--color-bg-soft)", borderBottom: "1px solid var(--color-border)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Ссылка на этот дашборд:</span>
          <div className="myd-share-url" style={{ flex: 1 }}>{shareUrl}</div>
          <button className="btn btn-secondary" style={{ fontSize: 11, padding: "3px 10px" }}
            onClick={() => { navigator.clipboard.writeText(shareUrl).catch(() => {}); setShareOpen(false); }}>
            Копировать
          </button>
          <button className="btn btn-secondary" style={{ fontSize: 11, padding: "3px 8px" }}
            onClick={() => setShareOpen(false)}>✕</button>
        </div>
      )}

      <div className="myd-body">
        {visible.size === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "var(--color-text-muted)", fontSize: 13 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📊</div>
            <p>Все виджеты скрыты. Нажмите «⚙ Настроить» чтобы добавить виджеты.</p>
          </div>
        ) : (
          <div className="myd-grid" ref={gridRef}>
            {visible.has("coverage")    && <CoverageWidget       projectId={pid} />}
            {visible.has("runs")        && <RecentRunsWidget     projectId={pid} />}
            {visible.has("changes")     && <LastActivityWidget   projectId={pid} />}
            {visible.has("case_by_req") && <CasesByReqMydWidget  projectId={pid} />}
          </div>
        )}
      </div>

      {cfgOpen && (
        <ConfigurePanel visible={visible} onToggle={toggleWidget} onClose={() => setCfgOpen(false)} />
      )}
    </div>
  );
}
