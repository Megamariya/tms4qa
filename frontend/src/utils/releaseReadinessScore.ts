// Release Readiness Score (RRS) — standalone calculation module

export interface RRSFactors {
  coverage: number;       // 0-100: % of requirements that have at least 1 test case
  executionRate: number;  // 0-100: % of test cases that were executed (non-untested)
  passRate: number;       // 0-100: % of executed cases that passed
  openBlockers: number;   // count of open blocker/critical defects
  flakyTests: number;     // count of test cases marked is_flaky
  untestedAreas: number;  // count of requirements with 0 test cases
  totalCases: number;     // total test cases (for flaky % calc)
}

export interface RRSWeights {
  coverage: number;          // contribution to base score (0-1)
  executionRate: number;     // contribution to base score (0-1)
  passRate: number;          // contribution to base score (0-1)
  blockerPenalty: number;    // penalty per blocker (0-1)
  flakyPenalty: number;      // penalty factor (0-1)
  untestedPenalty: number;   // penalty factor (0-1)
}

export const DEFAULT_RRS_WEIGHTS: RRSWeights = {
  coverage: 0.30,
  executionRate: 0.20,
  passRate: 0.25,
  blockerPenalty: 0.15,
  flakyPenalty: 0.05,
  untestedPenalty: 0.10,
};

export interface RRSThresholds {
  ready: number;       // default 90
  conditional: number; // default 75
  notReady: number;    // default 50
}

export const DEFAULT_RRS_THRESHOLDS: RRSThresholds = {
  ready: 90,
  conditional: 75,
  notReady: 50,
};

export type RRSVerdict = "ready" | "conditional" | "not_ready" | "blocked";

const VERDICT_META: Record<RRSVerdict, { label: string; emoji: string; color: string; bg: string; description: string }> = {
  ready:       { label: "Ready to Release",     emoji: "✅", color: "#16a34a", bg: "#dcfce7", description: "Все критерии качества выполнены. Релиз готов." },
  conditional: { label: "Conditional Release",  emoji: "⚠️", color: "#ca8a04", bg: "#fef9c3", description: "Релиз возможен с ограничениями. Требуется согласование." },
  not_ready:   { label: "Not Ready",            emoji: "🔶", color: "#ea580c", bg: "#ffedd5", description: "Значительные проблемы качества. Требуется доработка." },
  blocked:     { label: "Release Blocked",      emoji: "🚫", color: "#dc2626", bg: "#fee2e2", description: "Критические блокеры не позволяют выпускать релиз." },
};

export interface RRSFactorResult {
  key: string;
  name: string;
  value: number;       // raw value (%, count)
  unit: string;        // "%" or "items"
  contribution: number; // positive or negative points to final score
  maxContribution: number;
  status: "ok" | "warn" | "fail";
  description: string;
}

export interface RRSResult {
  score: number;
  verdict: RRSVerdict;
  verdictMeta: typeof VERDICT_META[RRSVerdict];
  factors: RRSFactorResult[];
  recommendations: string[];
}

export function loadRRSWeights(): RRSWeights {
  try {
    const s = localStorage.getItem("rrs_weights");
    if (s) return { ...DEFAULT_RRS_WEIGHTS, ...JSON.parse(s) };
  } catch { /* noop */ }
  return { ...DEFAULT_RRS_WEIGHTS };
}

export function saveRRSWeights(w: RRSWeights) {
  localStorage.setItem("rrs_weights", JSON.stringify(w));
}

export function loadRRSThresholds(): RRSThresholds {
  try {
    const s = localStorage.getItem("rrs_thresholds");
    if (s) return { ...DEFAULT_RRS_THRESHOLDS, ...JSON.parse(s) };
  } catch { /* noop */ }
  return { ...DEFAULT_RRS_THRESHOLDS };
}

export function saveRRSThresholds(t: RRSThresholds) {
  localStorage.setItem("rrs_thresholds", JSON.stringify(t));
}

export function calcRRS(
  factors: RRSFactors,
  weights: RRSWeights = DEFAULT_RRS_WEIGHTS,
  thresholds: RRSThresholds = DEFAULT_RRS_THRESHOLDS,
): RRSResult {
  // Base score components (positive)
  const coverageContrib   = factors.coverage   * weights.coverage;
  const executionContrib  = factors.executionRate * weights.executionRate;
  const passContrib       = factors.passRate   * weights.passRate;

  // Penalty components (negative)
  const blockerPenalty  = Math.min(factors.openBlockers * 12, 100) * weights.blockerPenalty;
  const flakyPct        = factors.totalCases > 0 ? (factors.flakyTests / factors.totalCases) * 100 : 0;
  const flakyPenalty    = Math.min(flakyPct * 2, 50) * weights.flakyPenalty;
  const untestedPenalty = Math.min(factors.untestedAreas * 6, 100) * weights.untestedPenalty;

  const rawScore = coverageContrib + executionContrib + passContrib
    - blockerPenalty - flakyPenalty - untestedPenalty;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));

  // Verdict
  let verdict: RRSVerdict;
  if (score >= thresholds.ready)       verdict = "ready";
  else if (score >= thresholds.conditional) verdict = "conditional";
  else if (score >= thresholds.notReady)    verdict = "not_ready";
  else                                       verdict = "blocked";

  const factorResults: RRSFactorResult[] = [
    {
      key: "coverage",
      name: "Requirements Coverage",
      value: Math.round(factors.coverage),
      unit: "%",
      contribution: Math.round(coverageContrib),
      maxContribution: Math.round(weights.coverage * 100),
      status: factors.coverage >= 80 ? "ok" : factors.coverage >= 50 ? "warn" : "fail",
      description: "Процент требований, покрытых тест-кейсами",
    },
    {
      key: "execution",
      name: "Execution Rate",
      value: Math.round(factors.executionRate),
      unit: "%",
      contribution: Math.round(executionContrib),
      maxContribution: Math.round(weights.executionRate * 100),
      status: factors.executionRate >= 90 ? "ok" : factors.executionRate >= 60 ? "warn" : "fail",
      description: "Процент выполненных тест-кейсов",
    },
    {
      key: "pass_rate",
      name: "Pass Rate",
      value: Math.round(factors.passRate),
      unit: "%",
      contribution: Math.round(passContrib),
      maxContribution: Math.round(weights.passRate * 100),
      status: factors.passRate >= 80 ? "ok" : factors.passRate >= 60 ? "warn" : "fail",
      description: "Процент успешно пройденных тест-кейсов из выполненных",
    },
    {
      key: "blockers",
      name: "Open Blockers",
      value: factors.openBlockers,
      unit: "items",
      contribution: -Math.round(blockerPenalty),
      maxContribution: 0,
      status: factors.openBlockers === 0 ? "ok" : factors.openBlockers <= 2 ? "warn" : "fail",
      description: "Открытые blocker/critical дефекты",
    },
    {
      key: "flaky",
      name: "Flaky Tests",
      value: factors.flakyTests,
      unit: "items",
      contribution: -Math.round(flakyPenalty),
      maxContribution: 0,
      status: factors.flakyTests === 0 ? "ok" : factors.flakyTests <= 3 ? "warn" : "fail",
      description: "Нестабильные тест-кейсы (is_flaky)",
    },
    {
      key: "untested",
      name: "Untested Areas",
      value: factors.untestedAreas,
      unit: "items",
      contribution: -Math.round(untestedPenalty),
      maxContribution: 0,
      status: factors.untestedAreas === 0 ? "ok" : factors.untestedAreas <= 2 ? "warn" : "fail",
      description: "Требования без тест-кейсов",
    },
  ];

  const recommendations: string[] = [];
  if (factors.coverage < 80)
    recommendations.push(`Покройте тест-кейсами больше требований (сейчас ${Math.round(factors.coverage)}%, цель ≥80%)`);
  if (factors.executionRate < 90)
    recommendations.push(`Выполните оставшиеся тест-кейсы (${Math.round(factors.executionRate)}% из 100% выполнено)`);
  if (factors.passRate < 80)
    recommendations.push(`Устраните дефекты: Pass Rate ${Math.round(factors.passRate)}%, цель ≥80%`);
  if (factors.openBlockers > 0)
    recommendations.push(`Закройте ${factors.openBlockers} blocker/critical дефект${factors.openBlockers === 1 ? "" : "а/ов"} до релиза`);
  if (factors.flakyTests > 0)
    recommendations.push(`Стабилизируйте ${factors.flakyTests} нестабильных тест-кейс${factors.flakyTests === 1 ? "" : "а/ов"}`);
  if (factors.untestedAreas > 0)
    recommendations.push(`Добавьте тест-кейсы для ${factors.untestedAreas} непокрытых требований`);
  if (recommendations.length === 0)
    recommendations.push("Все показатели в норме. Систему можно выпускать!");

  return { score, verdict, verdictMeta: VERDICT_META[verdict], factors: factorResults, recommendations };
}
