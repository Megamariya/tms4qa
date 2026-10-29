// Иконка статуса тест-кейса (actual / draft / review / deprecated).
// У каждого статуса своя форма и свой цвет — статус виден в списке без открытия кейса.
import type { CaseStatus } from "../api/client";

export const CASE_STATUS_META: Record<CaseStatus, { label: string; color: string; bg: string }> = {
  actual:     { label: "Actual",     color: "#16a34a", bg: "rgba(22,163,74,.12)" },
  draft:      { label: "Draft",      color: "#64748b", bg: "rgba(100,116,139,.14)" },
  review:     { label: "Review",     color: "#d97706", bg: "rgba(217,119,6,.14)" },
  deprecated: { label: "Deprecated", color: "#be123c", bg: "rgba(190,18,60,.12)" },
};

function renderGlyph(status: CaseStatus) {
  switch (status) {
    case "actual": // круг с галочкой
      return (<><circle cx="8" cy="8" r="6.5" /><path d="M5 8.2l2 2 4-4.2" /></>);
    case "draft": // карандаш
      return (<><path d="M10.8 2.7l2.5 2.5-7.6 7.6-3.2.7.7-3.2z" /><path d="M9.3 4.2l2.5 2.5" /></>);
    case "review": // глаз
      return (<><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" /></>);
    case "deprecated": // перечёркнутый круг
      return (<><circle cx="8" cy="8" r="6.5" /><path d="M3.4 12.6l9.2-9.2" /></>);
  }
}

export function CaseStatusIcon({ status, withLabel = false, size = 14 }: { status: CaseStatus; withLabel?: boolean; size?: number }) {
  const m = CASE_STATUS_META[status] ?? CASE_STATUS_META.draft;
  const svg = (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke={m.color}
      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flexShrink: 0 }}>
      {renderGlyph(status) ?? renderGlyph("draft")}
    </svg>
  );
  if (!withLabel) {
    return (
      <span className="case-status-icon" title={`Статус: ${m.label}`} aria-label={`Статус: ${m.label}`}
        style={{ display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
        {svg}
      </span>
    );
  }
  return (
    <span className="case-status-badge" title={`Статус: ${m.label}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 8px 1px 6px", borderRadius: 99,
        background: m.bg, color: m.color, fontSize: 11, fontWeight: 600, lineHeight: "18px", whiteSpace: "nowrap" }}>
      {svg}{m.label}
    </span>
  );
}
