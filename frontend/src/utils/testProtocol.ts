import { getStepExpectedResults, type TestCase, type TestResult, type TestRun, type TestSuite } from "../api/client";
import { mediaKind, mediaName } from "./media";

/** Вложение в HTML-отчёте: <img>, <video> или ссылка на файл. imgAttrs — атрибуты для картинки. */
function mediaHtml(url: string, imgAttrs: string): string {
  const kind = mediaKind(url);
  if (kind === "video") return `<video src="${url}" controls preload="metadata" style="max-width:300px;max-height:220px"></video>`;
  if (kind === "file") return `<a href="${url}" target="_blank">📄 ${mediaName(url)}</a>`;
  return `<img src="${url}" ${imgAttrs} />`;
}

// ── Static report config (edited in Configurations → Report Templates) ────────

export type ReportStaticCfg = {
  productName: string;         // Продукт / Наименование системы
  testingObject: string;       // Объект тестирования
  releaseVersion: string;      // Версия релиза
  testType: string;            // Тип тестирования
  basisDescription: string;    // Основание для тестирования (для акта)
  risks: string;               // Раздел "Риски" (акт)
  protocolConclusion: string;  // Итог протокола (пустая строка = авто)
  actConclusion: string;       // Заключение акта (пустая строка = авто)
  actDecision: "allow" | "allow_with_restrictions" | "deny" | "auto";
  // Подписи
  signaturesProtocol: { role: string; name: string }[];
  signaturesAct: { role: string; name: string }[];
  signaturesDefect: { role: string; name: string }[];
};

// ── Report Template App (Apps → Конструктор шаблонов) ────────────────────────

export type RtSectionCfg = { enabled: boolean; title: string };
export type ReportTemplateCfg = {
  protocol: {
    docTitle: string;
    showCaseDescription: boolean;
    showSuitePath: boolean;
    suitePathLabel: string;
    sections: { generalInfo: RtSectionCfg; purposes: RtSectionCfg; steps: RtSectionCfg; defects: RtSectionCfg; conclusion: RtSectionCfg; signatures: RtSectionCfg };
  };
  act: {
    docTitle: string;
    sections: { generalInfo: RtSectionCfg; results: RtSectionCfg; defects: RtSectionCfg; risks: RtSectionCfg; conclusion: RtSectionCfg; signatures: RtSectionCfg };
  };
  completion: {
    docTitle: string;
    scopeOfWork: string;
    sections: { intro: RtSectionCfg; workList: RtSectionCfg; results: RtSectionCfg; conclusion: RtSectionCfg; signatures: RtSectionCfg };
  };
  defect: {
    docTitle: string;
    sections: { header: RtSectionCfg; general: RtSectionCfg; steps: RtSectionCfg; expected: RtSectionCfg; screenshots: RtSectionCfg; signatures: RtSectionCfg };
  };
};

const RT_CFG_KEY = "report_template_app_cfg";
const RT_ENABLED_KEY = "report_template_app_enabled";

export function isReportTemplateEnabled(): boolean {
  return localStorage.getItem(RT_ENABLED_KEY) === "true";
}

function defaultRtSec(title: string): RtSectionCfg { return { enabled: true, title }; }

export function defaultReportTemplateCfg(): ReportTemplateCfg {
  return {
    protocol: {
      docTitle: "ПРОТОКОЛ ТЕСТИРОВАНИЯ",
      showCaseDescription: true,
      showSuitePath: false,
      suitePathLabel: "Путь: ",
      sections: {
        generalInfo: defaultRtSec("1. Общая информация"),
        purposes:    defaultRtSec("2. Цель тестирования"),
        steps:       defaultRtSec("3. Результаты тестирования"),
        defects:     defaultRtSec("4. Дефекты"),
        conclusion:  defaultRtSec("5. Итог"),
        signatures:  defaultRtSec("6. Подписи"),
      },
    },
    act: {
      docTitle: "АКТ ТЕСТИРОВАНИЯ",
      sections: {
        generalInfo: defaultRtSec("1. Общая информация"),
        results:     defaultRtSec("2. Результаты"),
        defects:     defaultRtSec("3. Дефекты"),
        risks:       defaultRtSec("4. Риски"),
        conclusion:  defaultRtSec("5. Заключение"),
        signatures:  defaultRtSec("6. Подписи"),
      },
    },
    completion: {
      docTitle: "АКТ ВЫПОЛНЕННЫХ РАБОТ",
      scopeOfWork: "",
      sections: {
        intro:      defaultRtSec("1. Предмет акта"),
        workList:   defaultRtSec("2. Перечень выполненных работ"),
        results:    defaultRtSec("3. Результаты тестирования"),
        conclusion: defaultRtSec("4. Заключение"),
        signatures: defaultRtSec("5. Подписи"),
      },
    },
    defect: {
      docTitle: "ОТЧЁТ О ДЕФЕКТЕ",
      sections: {
        header:      defaultRtSec("Заголовок"),
        general:     defaultRtSec("1. Общая информация"),
        steps:       defaultRtSec("2. Шаги воспроизведения"),
        expected:    defaultRtSec("3. Ожидаемый / фактический результат"),
        screenshots: defaultRtSec("4. Скриншоты"),
        signatures:  defaultRtSec("5. Подписи"),
      },
    },
  };
}

export function loadReportTemplateCfg(): ReportTemplateCfg {
  try {
    const raw = localStorage.getItem(RT_CFG_KEY);
    if (!raw) return defaultReportTemplateCfg();
    const parsed = JSON.parse(raw);
    const def = defaultReportTemplateCfg();
    return {
      protocol:   { ...def.protocol,   ...parsed.protocol,   showCaseDescription: parsed.protocol?.showCaseDescription ?? true, sections: { ...def.protocol.sections,   ...(parsed.protocol?.sections ?? {}) } },
      act:        { ...def.act,         ...parsed.act,         sections: { ...def.act.sections,         ...(parsed.act?.sections ?? {}) } },
      completion: { ...def.completion,  ...parsed.completion,  sections: { ...def.completion.sections,  ...(parsed.completion?.sections ?? {}) } },
      defect:     { ...def.defect,      ...parsed.defect,      sections: { ...def.defect.sections,      ...(parsed.defect?.sections ?? {}) } },
    };
  } catch { return defaultReportTemplateCfg(); }
}

export function saveReportTemplateCfg(cfg: ReportTemplateCfg) {
  localStorage.setItem(RT_CFG_KEY, JSON.stringify(cfg));
}

// ── Static config ─────────────────────────────────────────────────────────────

const REPORT_CFG_KEY = "report_static_cfg";

export function loadReportStaticCfg(): ReportStaticCfg {
  try {
    const raw = localStorage.getItem(REPORT_CFG_KEY);
    return raw ? { ...defaultReportCfg(), ...JSON.parse(raw) } : defaultReportCfg();
  } catch { return defaultReportCfg(); }
}

export function saveReportStaticCfg(cfg: ReportStaticCfg) {
  localStorage.setItem(REPORT_CFG_KEY, JSON.stringify(cfg));
}

function defaultReportCfg(): ReportStaticCfg {
  return {
    productName: "",
    testingObject: "",
    releaseVersion: "",
    testType: "Функциональное тестирование",
    basisDescription: "Требования к программному обеспечению",
    risks: "На момент проведения тестирования риски, влияющие на работоспособность системы, не обнаружены.",
    protocolConclusion: "",
    actConclusion: "",
    actDecision: "auto",
    signaturesProtocol: [
      { role: "QA инженер", name: "" },
      { role: "QA Lead / Team Lead", name: "" },
      { role: "Product Owner / Бизнес", name: "" },
    ],
    signaturesAct: [
      { role: "QA Lead / Team Lead", name: "" },
      { role: "Представитель разработки", name: "" },
      { role: "Product Owner / Бизнес", name: "" },
    ],
    signaturesDefect: [
      { role: "QA инженер", name: "" },
      { role: "Руководитель подразделения / PM", name: "" },
      { role: "Разработчик", name: "" },
      { role: "Лид разработки / Tech Lead", name: "" },
    ],
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string, withTime = false): string {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString("ru-RU");
    if (!withTime) return date;
    const time = d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
    return `${date} ${time}`;
  } catch { return "—"; }
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    passed: "Пройден ✓",
    failed: "Не пройден ✗",
    blocked: "Заблокирован",
    skipped: "Пропущен",
    invalid: "Неверный",
    retest: "Требует проверки",
    untested: "Не проверен",
    in_progress: "В процессе",
  };
  return map[status] ?? status;
}

function statusColor(status: string): string {
  const map: Record<string, string> = {
    passed: "#16a34a",
    failed: "#dc2626",
    blocked: "#ca8a04",
    skipped: "#6b7280",
    invalid: "#7c3aed",
    untested: "#9ca3af",
    in_progress: "#2563eb",
    retest: "#ca8a04",
  };
  return map[status] ?? "#6b7280";
}

function protocolNum(runId: string): string {
  return runId.replace(/-/g, "").slice(0, 6).toUpperCase();
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^а-яёА-ЯЁa-zA-Z0-9\-_ ]/g, "").trim().replace(/ /g, "_").slice(0, 40);
}

function escHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ── CSS base ──────────────────────────────────────────────────────────────────

const BASE_STYLE = `
  body{font-family:Arial,sans-serif;font-size:13px;color:#111;margin:0;padding:0;background:#d4d4d4}
  .page{background:#fff;max-width:794px;margin:20px auto;padding:40px 52px 56px;box-shadow:0 4px 24px rgba(0,0,0,.18);min-height:1120px;box-sizing:border-box}
  h1{font-size:17px;text-align:center;margin:0 0 5px;text-transform:uppercase;letter-spacing:.06em;font-weight:700}
  h2{font-size:13px;font-weight:700;margin:22px 0 8px;border-bottom:2px solid #222;padding-bottom:3px;text-transform:uppercase;letter-spacing:.03em}
  .subtitle{text-align:center;font-size:14px;color:#333;margin-bottom:4px;font-style:italic}
  .doc-date{text-align:center;font-size:12px;color:#666;margin-bottom:14px}
  .act-ref{display:flex;gap:40px;justify-content:flex-end;font-size:12px;color:#666;margin-bottom:20px;border-top:1px solid #e5e5e5;padding-top:10px}
  table.info{width:100%;border-collapse:collapse;margin-bottom:16px}
  table.info td{border:1px solid #c8c8c8;padding:7px 12px;font-size:12.5px}
  table.info td:first-child{background:#f4f4f4;font-weight:600;width:38%;white-space:nowrap}
  table.steps{width:100%;border-collapse:collapse;font-size:11.5px;margin-top:6px}
  table.steps th{background:#efefef;border:1px solid #ccc;padding:5px 8px;text-align:left;font-weight:600}
  table.steps td{border:1px solid #ddd;padding:6px 8px;vertical-align:top;line-height:1.45}
  .case-head{display:flex;justify-content:space-between;align-items:center;background:#f8f9fa;border:1px solid #dde1e7;border-radius:4px;padding:7px 12px;margin-bottom:6px}
  .case-num{font-weight:700;font-size:12.5px;color:#222}
  .case-status{font-weight:700;font-size:12px;padding:2px 10px;border-radius:12px;background:rgba(0,0,0,.06)}
  .case-precond{font-size:11.5px;color:#555;background:#f9fafb;border:1px solid #e5e7eb;border-radius:3px;padding:5px 10px;margin-bottom:6px}
  .case-suite-path{font-size:10.5px;color:#7c8898;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:3px;padding:3px 10px;margin-bottom:5px;font-family:inherit}
  .defect-box{background:#fff8f8;border:1px solid #f5c6cb;border-radius:4px;padding:10px 16px;font-size:12.5px}
  .ok-box{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:4px;padding:10px 16px;font-size:12.5px}
  .conclusion{background:#f0f4ff;border:1px solid #c7d2fe;border-radius:4px;padding:12px 16px;font-size:12.5px;line-height:1.6}
  table.sign{width:100%;border-collapse:collapse;margin-top:8px}
  table.sign th{background:#f0f0f0;border:1px solid #ccc;padding:6px 10px;font-size:11.5px;text-align:center}
  table.sign td{border:1px solid #ccc;padding:9px 10px;height:32px;font-size:12px}
  .footer{text-align:center;color:#b0b0b0;font-size:10px;margin-top:44px;padding-top:10px;border-top:1px solid #eee}
  .case-wrap{margin-bottom:22px}
  .attention-box{background:#fefce8;border:1px solid #e0c97a;border-radius:4px;padding:10px 16px;font-size:12.5px}
  .screenshot-thumb{max-width:240px;max-height:180px;border:1px solid #ddd;border-radius:3px;cursor:pointer}
  .screenshot-cell{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-start}
  @media print{body{background:#fff}.page{box-shadow:none;margin:0;padding:15mm 20mm}@page{size:A4;margin:12mm}
    .screenshot-thumb{max-width:200px;max-height:150px;page-break-inside:avoid}}
`;

// ── Protocol (Протокол тестирования) ─────────────────────────────────────────

export function generateProtocolHTML(
  run: TestRun,
  results: TestResult[],
  casesMap: Record<string, TestCase>,
  suites: TestSuite[],
  attachmentsMap: Record<string, Record<number, string[]>> = {},
  projectName?: string,
): string {
  const cfg = loadReportStaticCfg();
  const num = protocolNum(run.id);
  const now = new Date();
  const nowStr = `${now.toLocaleDateString("ru-RU")} ${now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
  const testDateShort = fmtDate(run.started_at);
  const durationSec = run.completed_at
    ? Math.round((new Date(run.completed_at).getTime() - new Date(run.started_at).getTime()) / 1000)
    : null;
  const durationStr = durationSec !== null
    ? `${Math.floor(durationSec / 60)} мин ${durationSec % 60} с`
    : "—";

  const total = results.length;
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const blocked = results.filter((r) => r.status === "blocked").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const invalid = results.filter((r) => r.status === "invalid").length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  const suiteMap = new Map(suites.map((s) => [s.id, s]));

  const getSuitePath = (tc: TestCase): string => {
    if (!tc.test_suite_id) return "";
    const path: string[] = [];
    let cur = suiteMap.get(tc.test_suite_id);
    while (cur) {
      path.unshift(cur.name);
      cur = cur.parent_id ? suiteMap.get(cur.parent_id) : undefined;
    }
    return path.join(" / ");
  };

  const byCase = results
    .map((r) => ({ result: r, tc: casesMap[r.test_case_id] }))
    .filter((x) => x.tc);

  const suiteNames = [...new Set(byCase
    .map(({ tc }) => tc.test_suite_id ? suiteMap.get(tc.test_suite_id)?.name : null)
    .filter(Boolean) as string[])];
  const moduleName = suiteNames.length > 0 ? suiteNames.join(", ") : run.name;

  const purposes = byCase.map(({ tc }) =>
    `<li style="margin-bottom:4px">Проверить корректность работы: <em>${escHtml(tc.name)}</em></li>`
  ).join("");

  // Template integration — must be declared BEFORE resultSections uses it
  const tmpl = isReportTemplateEnabled() ? loadReportTemplateCfg() : null;
  const pt = tmpl?.protocol;
  const docTitle = pt?.docTitle ?? "ПРОТОКОЛ ТЕСТИРОВАНИЯ";
  const sec = (key: keyof NonNullable<typeof pt>["sections"], fallback: string) =>
    pt ? (pt.sections[key].enabled ? pt.sections[key].title : null) : fallback;

  // ── Build result sections ──
  const resultSections = byCase.map(({ result, tc }, idx) => {
    const color = statusColor(result.status);
    const label = statusLabel(result.status);
    const resultAttach = attachmentsMap[result.id] ?? {};

    let stepsRows = "";
    if (tc.steps && tc.steps.length > 0) {
      const stepActuals: Record<number, string> = {};
      if (result.actual_result) {
        for (const line of result.actual_result.split("\n")) {
          const m = line.match(/^Step (\d+): (.*)$/);
          if (m) stepActuals[parseInt(m[1]) - 1] = m[2];
        }
      }
      stepsRows = tc.steps.map((step, si) => {
        const expList = getStepExpectedResults(step);
        const expCell = expList.length > 1
          ? `<ol style="margin:0;padding-left:16px">${expList.map((e) => `<li>${escHtml(e)}</li>`).join("")}</ol>`
          : escHtml(expList[0] || "—");
        const isLastStep = si === tc.steps.length - 1;
        const stepActual = stepActuals[si] ?? (isLastStep ? (result.actual_result || result.comment || "—") : "—");
        const stepStatus = isLastStep
          ? `<span style="color:${color};font-weight:600">${label}</span>`
          : (result.status === "passed" ? `<span style="color:#16a34a">Пройден ✓</span>` : "—");

        // Screenshots for this step
        const stepUrls = resultAttach[si] ?? [];
        const screenshotsCell = stepUrls.length > 0
          ? `<div class="screenshot-cell">${stepUrls.map((url) =>
              mediaHtml(url, `class="screenshot-thumb" alt="скриншот" onclick="this.style.maxWidth=this.style.maxWidth==='none'?'120px':'none'"`)
            ).join("")}</div>`
          : "—";

        return `
        <tr>
          <td style="text-align:center;width:28px">${si + 1}</td>
          <td>${escHtml(step.action || "—")}${step.data ? `<br><span style="color:#666;font-size:11px">Данные: ${escHtml(step.data)}</span>` : ""}</td>
          <td>${expCell}</td>
          <td>${escHtml(stepActual)}</td>
          <td style="width:100px">${screenshotsCell}</td>
          <td style="width:110px">${stepStatus}</td>
        </tr>`;
      }).join("");
    } else {
      // No steps — single row
      const allUrls = Object.values(resultAttach).flat();
      const screenshotsCell = allUrls.length > 0
        ? `<div class="screenshot-cell">${allUrls.map((url) =>
            mediaHtml(url, `class="screenshot-thumb" alt="скриншот"`)
          ).join("")}</div>`
        : "—";
      stepsRows = `
        <tr>
          <td style="text-align:center;width:28px">1</td>
          <td>${escHtml(tc.description || "Выполнить тест-кейс согласно описанию")}</td>
          <td>${escHtml(tc.pre_conditions || "Согласно тест-кейсу")}</td>
          <td>${escHtml(result.actual_result || result.comment || "—")}</td>
          <td style="width:100px">${screenshotsCell}</td>
          <td style="color:${color};font-weight:600;white-space:nowrap;width:110px">${label}</td>
        </tr>`;
    }

    const precondBlock = tc.pre_conditions
      ? `<div class="case-precond"><strong>Предусловия:</strong> ${escHtml(tc.pre_conditions)}</div>`
      : "";

    const showDesc = tmpl ? tmpl.protocol.showCaseDescription : true;
    const descBlock = showDesc && tc.description
      ? `<div class="case-precond" style="color:#333;background:#f0f4ff;border-color:#c7d2fe"><strong>Описание:</strong> ${escHtml(tc.description)}</div>`
      : "";

    const showPath = tmpl ? (tmpl.protocol.showSuitePath ?? false) : false;
    const pathLabel = tmpl ? (tmpl.protocol.suitePathLabel ?? "Путь: ") : "Путь: ";
    const suitePath = getSuitePath(tc);
    const suitePathBlock = showPath && suitePath
      ? `<div class="case-suite-path">${escHtml(pathLabel)}${escHtml(suitePath)}</div>`
      : "";

    return `
      <div class="case-wrap">
        <div class="case-head">
          <span class="case-num">3.${idx + 1}. ${escHtml(tc.name)}</span>
          <span class="case-status" style="color:${color}">${label}</span>
        </div>
        ${suitePathBlock}
        ${descBlock}
        ${precondBlock}
        <table class="steps">
          <thead>
            <tr>
              <th style="width:28px">№</th>
              <th style="width:28%">Шаги воспроизведения</th>
              <th style="width:20%">Ожидаемый результат</th>
              <th style="width:20%">Фактический результат</th>
              <th style="width:100px">Скрин</th>
              <th style="width:110px">Статус</th>
            </tr>
          </thead>
          <tbody>${stepsRows}</tbody>
        </table>
      </div>`;
  }).join("");

  const defectsBlock = (failed > 0 || blocked > 0)
    ? `<div class="defect-box">Зафиксировано проблем: <strong>${failed + blocked}</strong> (не пройдено: ${failed}, заблокировано: ${blocked}). Требуется устранение перед выпуском в продуктивную среду.</div>`
    : `<div class="ok-box">Дефекты не зафиксированы.</div>`;

  const attentionResults = byCase.filter(({ result }) =>
    ["blocked", "skipped", "invalid"].includes(result.status)
  );
  const attentionBlock = attentionResults.length > 0
    ? `<div class="attention-box" style="margin-top:12px">
        <strong>Тест-кейсы, требующие внимания (${attentionResults.length}):</strong>
        <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:11.5px">
          <thead><tr>
            <th style="border:1px solid #e0c97a;background:#fefce8;padding:5px 8px;text-align:left">Тест-кейс</th>
            <th style="border:1px solid #e0c97a;background:#fefce8;padding:5px 8px;width:100px">Статус</th>
            <th style="border:1px solid #e0c97a;background:#fefce8;padding:5px 8px">Причина</th>
          </tr></thead>
          <tbody>
          ${attentionResults.map(({ result, tc }) => {
            const reason = result.comment ? result.comment.split("\n")[0] : "—";
            const color = statusColor(result.status);
            return `<tr>
              <td style="border:1px solid #e5e7eb;padding:5px 8px">${escHtml(tc.name)}</td>
              <td style="border:1px solid #e5e7eb;padding:5px 8px;color:${color};font-weight:600">${statusLabel(result.status)}</td>
              <td style="border:1px solid #e5e7eb;padding:5px 8px;color:#555">${escHtml(reason)}</td>
            </tr>`;
          }).join("")}
          </tbody>
        </table>
      </div>`
    : "";

  const verdict = passed === total && total > 0 ? "успешно" : "с замечаниями";
  const autoConclusion = `По результатам проведённого тестирования установлено, что проверенные функциональные возможности системы работают ${verdict} в соответствии с предъявляемыми требованиями. Всего тест-кейсов: ${total}. Пройдено: ${passed}. Не пройдено: ${failed}.${skipped > 0 ? ` Пропущено: ${skipped}.` : ""}${blocked > 0 ? ` Заблокировано: ${blocked}.` : ""}${invalid > 0 ? ` Неверных: ${invalid}.` : ""} Pass rate: ${passRate}%.`;
  const conclusion = cfg.protocolConclusion.trim() || autoConclusion;

  const sigRows = cfg.signaturesProtocol.map((s) =>
    `<tr><td>${escHtml(s.role)}</td><td>${escHtml(s.name)}</td><td>${testDateShort}</td><td></td></tr>`
  ).join("");

  return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><title>${docTitle} № ${num}</title>
<style>${BASE_STYLE}</style></head>
<body><div class="page">
  <h1>${docTitle} № ${num}</h1>
  <div class="subtitle">${escHtml(run.name)}</div>
  <div class="doc-date">${testDateShort}</div>
  <div class="act-ref">
    <span>К акту тестирования №:&nbsp;_________</span>
    <span>Дата акта:&nbsp;_________</span>
  </div>

  ${sec("generalInfo", "1. Общая информация") !== null ? `
  <h2>${sec("generalInfo", "1. Общая информация")}</h2>
  <table class="info">
    ${projectName ? `<tr><td>Проект</td><td>${escHtml(projectName)}</td></tr>` : (cfg.productName ? `<tr><td>Проект</td><td>${escHtml(cfg.productName)}</td></tr>` : "")}
    ${cfg.testingObject ? `<tr><td>Объект тестирования</td><td>${escHtml(cfg.testingObject)}</td></tr>` : `<tr><td>Объект тестирования</td><td>${escHtml(moduleName)}</td></tr>`}
    <tr><td>Основание для тестирования</td><td>${escHtml(cfg.basisDescription || "Требования к программному обеспечению")}</td></tr>
    <tr><td>Тип тестирования</td><td>${escHtml(cfg.testType || "Функциональное тестирование")}</td></tr>
    <tr><td>Окружение</td><td>${escHtml(run.environment || "—")}</td></tr>
    ${cfg.releaseVersion ? `<tr><td>Версия релиза</td><td>${escHtml(cfg.releaseVersion)}</td></tr>` : ""}
    <tr><td>Тип устройства</td><td>${escHtml(run.device_type ? run.device_type.charAt(0).toUpperCase() + run.device_type.slice(1) : "—")}</td></tr>
    <tr><td>Операционная система</td><td>${escHtml([run.os, run.os_version].filter(Boolean).join(" ") || "—")}</td></tr>
    <tr><td>Дата проведения тестирования</td><td>${fmtDate(run.started_at, true)}</td></tr>
    <tr><td>Дата окончания прогона</td><td>${run.completed_at ? fmtDate(run.completed_at, true) : "—"}</td></tr>
    <tr><td>Длительность прогона</td><td>${durationStr}</td></tr>
    <tr><td>Тестировщик</td><td>${escHtml(run.started_by_name || "QA")}</td></tr>
  </table>` : ""}

  ${sec("purposes", "2. Цель тестирования") !== null ? `
  <h2>${sec("purposes", "2. Цель тестирования")}</h2>
  <ul style="font-size:12.5px;margin:0 0 14px;padding-left:22px;line-height:1.8">
    ${purposes || "<li>—</li>"}
  </ul>` : ""}

  ${sec("steps", "3. Результаты тестирования") !== null ? `
  <h2>${sec("steps", "3. Результаты тестирования")}</h2>
  ${resultSections || "<p style='color:#666'>Тест-кейсы отсутствуют.</p>"}` : ""}

  ${sec("defects", "4. Дефекты") !== null ? `
  <h2>${sec("defects", "4. Дефекты")}</h2>
  ${defectsBlock}
  ${attentionBlock}` : ""}

  ${sec("conclusion", "5. Итог") !== null ? `
  <h2>${sec("conclusion", "5. Итог")}</h2>
  <div class="conclusion">${escHtml(conclusion)}</div>` : ""}

  ${sec("signatures", "6. Подписи") !== null ? `
  <h2>${sec("signatures", "6. Подписи")}</h2>
  <table class="sign">
    <thead><tr><th>Должность</th><th>ФИО</th><th>Дата</th><th>Подпись</th></tr></thead>
    <tbody>${sigRows || `
      <tr><td>QA инженер</td><td></td><td>${testDateShort}</td><td></td></tr>
      <tr><td>QA Lead / Team Lead</td><td></td><td></td><td></td></tr>
      <tr><td>Product Owner / Бизнес</td><td></td><td></td><td></td></tr>
    `}</tbody>
  </table>` : ""}

  <div class="footer">Сформировано системой 4QA TMS · ${nowStr}</div>
</div></body></html>`;
}

// ── Act (Акт тестирования) ────────────────────────────────────────────────────

export function generateActHTML(
  run: TestRun,
  results: TestResult[],
  casesMap: Record<string, TestCase>,
  suites: TestSuite[],
  planName?: string | null,
): string {
  const cfg = loadReportStaticCfg();
  const num = protocolNum(run.id);
  const now = new Date();
  const nowStr = `${now.toLocaleDateString("ru-RU")} ${now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
  const testDateShort = fmtDate(run.started_at);

  const total = results.length;
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const blocked = results.filter((r) => r.status === "blocked").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  const untested = results.filter((r) => r.status === "untested").length;
  const passRate = total > 0 ? Math.round((passed / total) * 100) : 0;

  const suiteMap = new Map(suites.map((s) => [s.id, s]));
  const byCase = results
    .map((r) => ({ result: r, tc: casesMap[r.test_case_id] }))
    .filter((x) => x.tc);

  // Determine decision
  const autoAccepted = failed === 0 && blocked === 0 && total > 0;
  let decisionKey = cfg.actDecision === "auto"
    ? (autoAccepted ? "allow" : "deny")
    : cfg.actDecision;

  const DECISION_LABELS = {
    allow: "Разрешить релиз",
    allow_with_restrictions: "Разрешить релиз с ограничениями",
    deny: "Запретить релиз",
  };
  const DECISION_COLORS = {
    allow: "#16a34a",
    allow_with_restrictions: "#ca8a04",
    deny: "#dc2626",
  };
  const DECISION_BG = {
    allow: "#f0fdf4",
    allow_with_restrictions: "#fefce8",
    deny: "#fef2f2",
  };

  const decisionColor = DECISION_COLORS[decisionKey as keyof typeof DECISION_COLORS] ?? "#16a34a";
  const decisionBg = DECISION_BG[decisionKey as keyof typeof DECISION_BG] ?? "#f0fdf4";

  // Decision checkboxes
  const decisionCheckboxes = (Object.entries(DECISION_LABELS) as [string, string][]).map(([key, label]) => {
    const checked = key === decisionKey;
    const mark = checked ? `<span style="font-size:16px;color:${decisionColor}">☑</span>` : `<span style="font-size:16px;color:#aaa">☐</span>`;
    return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px;${checked ? `font-weight:700;color:${decisionColor}` : "color:#555"}">
      ${mark} ${label}
    </div>`;
  }).join("");

  // Functional areas from suites
  const uniqueSuites = [...new Set(byCase
    .map(({ tc }) => tc.test_suite_id ? suiteMap.get(tc.test_suite_id)?.name : null)
    .filter(Boolean) as string[])];

  const areasTable = uniqueSuites.length > 0
    ? uniqueSuites.map((name, i) =>
        `<tr><td style="border:1px solid #ddd;padding:6px 10px;text-align:center">${i + 1}</td>
         <td style="border:1px solid #ddd;padding:6px 10px">${escHtml(name)}</td></tr>`
      ).join("")
    : `<tr><td style="border:1px solid #ddd;padding:6px 10px;text-align:center">1</td>
       <td style="border:1px solid #ddd;padding:6px 10px">${escHtml(run.name)}</td></tr>`;

  // Defects by severity
  const failedCases = byCase.filter(({ result }) => result.status === "failed" || result.status === "blocked");
  const defectsBySev: Record<string, typeof failedCases> = { critical: [], major: [], minor: [] };
  for (const item of failedCases) {
    const sev = item.tc.severity ?? "normal";
    if (["blocker", "critical"].includes(sev)) defectsBySev.critical.push(item);
    else if (["major", "normal"].includes(sev)) defectsBySev.major.push(item);
    else defectsBySev.minor.push(item);
  }

  const autoConclusion = autoAccepted
    ? `По результатам проведённого тестирования установлено, что реализованный функционал работает корректно и соответствует заявленным требованиям. Критических и значимых дефектов не выявлено. Система готова к дальнейшей эксплуатации / передаче в промышленную среду.`
    : `По результатам проведённого тестирования выявлены дефекты, требующие устранения. Не пройдено: ${failed}. Заблокировано: ${blocked}. Pass Rate: ${passRate}%. Система не рекомендована к выпуску до устранения критических замечаний.`;
  const conclusion = cfg.actConclusion.trim() || autoConclusion;

  const periodTo = run.completed_at ? ` — ${fmtDate(run.completed_at)}` : "";

  const sigRows = cfg.signaturesAct.map((s) =>
    `<tr><td>${escHtml(s.role)}</td><td>${escHtml(s.name)}</td><td></td><td></td></tr>`
  ).join("");

  // Template integration
  const tmpl = isReportTemplateEnabled() ? loadReportTemplateCfg() : null;
  const at = tmpl?.act;
  const docTitleAct = at?.docTitle ?? "АКТ ПРОВЕДЕНИЯ ТЕСТИРОВАНИЯ";
  const secA = (key: keyof NonNullable<typeof at>["sections"], fallback: string): string | null =>
    at ? (at.sections[key].enabled ? at.sections[key].title : null) : fallback;

  const hGI  = secA("generalInfo", "1. Общая информация");
  const hRes = secA("results",     "6. Результаты тестирования");
  const hDef = secA("defects",     "7. Дефекты");
  const hRsk = secA("risks",       "8. Риски");
  const hCon = secA("conclusion",  "9. Заключение");
  const hSig = secA("signatures",  "12. Подписи членов комиссии");

  const critText = defectsBySev.critical.length > 0
    ? `<strong>${defectsBySev.critical.length}</strong> — ${defectsBySev.critical.map(({ tc }) => escHtml(tc.name)).join("; ")}`
    : "не выявлено";
  const majText = defectsBySev.major.length > 0
    ? `<strong>${defectsBySev.major.length}</strong> — ${defectsBySev.major.map(({ tc }) => escHtml(tc.name)).join("; ")}`
    : "не выявлено";
  const minText = defectsBySev.minor.length > 0
    ? `<strong>${defectsBySev.minor.length}</strong> — ${defectsBySev.minor.map(({ tc }) => escHtml(tc.name)).join("; ")}`
    : "не выявлено";
  const defectBody = failed === 0 && blocked === 0
    ? `<div class="ok-box">Дефекты по результатам тестирования не зафиксированы.</div>`
    : `<div class="defect-box">
        <div style="margin-bottom:6px">Критические (S1–S2 Blocker / Critical): ${critText}</div>
        <div style="margin-bottom:6px">Средние (S3–S4 Major / Normal): ${majText}</div>
        <div>Незначительные (S5 Minor / Trivial): ${minText}</div>
      </div>`;

  return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><title>${docTitleAct} № ${num}</title>
<style>${BASE_STYLE}
  .act-title-block{text-align:center;margin-bottom:0;padding-bottom:14px;border-bottom:2px solid #222}
  .act-meta{text-align:right;font-size:12px;color:#555;margin-top:8px;margin-bottom:20px}
  .commission li{margin-bottom:8px;font-size:12.5px;line-height:1.6}
  table.stat{width:100%;border-collapse:collapse;margin:8px 0 4px}
  table.stat th{background:#efefef;border:1px solid #ccc;padding:6px 10px;font-size:11.5px;text-align:center}
  table.stat td{border:1px solid #ddd;padding:8px;font-size:13px;text-align:center;font-weight:700}
  .decision-box{padding:14px 20px;border-radius:6px;border:2px solid;margin:10px 0;background:${decisionBg};border-color:${decisionColor}}
  .pass-rate-big{font-size:18px;font-weight:700;color:${passRate >= 80 ? "#16a34a" : passRate >= 60 ? "#ca8a04" : "#dc2626"};padding:6px 0;display:inline-block}
</style></head>
<body><div class="page">
  <div class="act-title-block">
    <h1>${docTitleAct} № ${num}</h1>
    <div style="font-size:13px;color:#444;margin-top:6px;font-style:italic">${escHtml(cfg.testType ? cfg.testType + " " + run.name : run.name)}</div>
  </div>
  <div class="act-meta">Дата акта: ${testDateShort}</div>

  ${hGI !== null ? `
  <h2>${hGI}</h2>
  <table class="info">
    ${cfg.productName ? `<tr><td>Продукт</td><td>${escHtml(cfg.productName)}</td></tr>` : ""}
    ${cfg.testingObject ? `<tr><td>Функциональность</td><td>${escHtml(cfg.testingObject)}</td></tr>` : ""}
    ${cfg.releaseVersion ? `<tr><td>Версия релиза</td><td>${escHtml(cfg.releaseVersion)}</td></tr>` : ""}
    <tr><td>Окружение</td><td>${escHtml(run.environment || "—")}</td></tr>
    <tr><td>Дата тестирования</td><td>${testDateShort}${escHtml(periodTo)}</td></tr>
    <tr><td>Тестирование выполнил</td><td>${escHtml(run.started_by_name || "QA")}</td></tr>
  </table>

  <h2>2. Основание для тестирования</h2>
  <table class="info">
    <tr><td>Источник требований</td><td>${escHtml(cfg.basisDescription || "Требования к программному обеспечению")}</td></tr>
    ${planName ? `<tr><td>Тестовый план</td><td>${escHtml(planName)}</td></tr>` : ""}
  </table>

  <h2>3. Цель тестирования</h2>
  <ul style="font-size:12.5px;margin:0 0 14px;padding-left:22px;line-height:1.8">
    <li>Проверка готовности функционала к релизу</li>
    <li>Подтверждение соответствия функционала требованиям</li>
    <li>Выявление критических дефектов, влияющих на бизнес-процессы</li>
  </ul>

  <h2>4. Область тестирования</h2>
  <table style="width:100%;border-collapse:collapse;font-size:12.5px">
    <thead>
      <tr>
        <th style="border:1px solid #ccc;background:#f4f4f4;padding:6px 10px;width:40px">#</th>
        <th style="border:1px solid #ccc;background:#f4f4f4;padding:6px 10px;text-align:left">Название функциональной возможности</th>
      </tr>
    </thead>
    <tbody>${areasTable}</tbody>
  </table>

  <h2>5. Виды проведённого тестирования</h2>
  <ul style="font-size:12.5px;margin:0 0 14px;padding-left:22px">
    <li>${escHtml(cfg.testType || "Функциональное тестирование")}</li>
  </ul>
  ` : ""}

  ${hRes !== null ? `
  <h2>${hRes}</h2>
  <table class="stat">
    <thead>
      <tr>
        <th>Всего</th><th>Пройдено ✓</th><th>Не пройдено ✗</th><th>Заблокировано</th><th>Пропущено</th><th>Не выполнено</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>${total}</td>
        <td style="color:#16a34a">${passed}</td>
        <td style="color:#dc2626">${failed}</td>
        <td style="color:#ca8a04">${blocked}</td>
        <td style="color:#6b7280">${skipped}</td>
        <td style="color:#9ca3af">${untested}</td>
      </tr>
    </tbody>
  </table>
  <div class="pass-rate-big">Pass Rate: ${passRate}%</div>
  ` : ""}

  ${hDef !== null ? `
  <h2>${hDef}</h2>
  ${defectBody}
  ` : ""}

  ${hRsk !== null ? `
  <h2>${hRsk}</h2>
  <p style="font-size:12.5px;line-height:1.7;margin:0 0 16px">
    ${escHtml(cfg.risks || "На момент проведения тестирования риски, влияющие на работоспособность системы, не обнаружены.")}
  </p>
  ` : ""}

  ${hCon !== null ? `
  <h2>${hCon}</h2>
  <div class="conclusion">${escHtml(conclusion)}</div>

  <h2>10. Решение</h2>
  <div class="decision-box">
    ${decisionCheckboxes}
  </div>
  ` : ""}

  ${hSig !== null ? `
  <h2>11. Ссылки на материалы</h2>
  <table class="info">
    <tr><td>Test Run (детальный протокол)</td><td>Протокол тестирования № ${num}</td></tr>
    <tr><td>Тест-кейсы</td><td>${total} кейсов</td></tr>
  </table>

  <h2>${hSig}</h2>
  <table class="sign">
    <thead><tr><th>Должность</th><th>ФИО</th><th>Дата</th><th>Подпись</th></tr></thead>
    <tbody>${sigRows || `
      <tr><td>QA Lead / Team Lead</td><td></td><td></td><td></td></tr>
      <tr><td>Представитель разработки</td><td></td><td></td><td></td></tr>
      <tr><td>Product Owner / Бизнес</td><td></td><td></td><td></td></tr>
    `}</tbody>
  </table>
  ` : ""}

  <div class="footer">Сформировано системой 4QA TMS · ${nowStr}</div>
</div></body></html>`;
}

// ── Defect Report ─────────────────────────────────────────────────────────────

export type DefectForReport = {
  id: string;
  display_id?: string | null;
  display_seq?: number | null;
  title: string;
  severity: string;
  status: string;
  environment?: string | null;
  impact?: string | null;
  description?: string | null;
  steps_to_reproduce?: string | null;
  expected_result?: string | null;
  actual_result?: string | null;
  tags?: string[] | null;
  created_at: string;
  updated_at?: string | null;
};

export function generateDefectReportHTML(defect: DefectForReport, attachments: string[] = []): string {
  const cfg = loadReportStaticCfg();
  const now = new Date();
  const nowStr = `${now.toLocaleDateString("ru-RU")} ${now.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}`;
  const displayId = defect.display_id ?? (defect.display_seq ? `D-${defect.display_seq}` : defect.id.slice(0, 8).toUpperCase());

  const SEV_COLOR: Record<string, string> = {
    blocker: "#b91c1c", critical: "#c2410c", major: "#b45309",
    normal: "#4b5563", minor: "#1e40af", trivial: "#6b7280",
  };
  const SEV_BG: Record<string, string> = {
    blocker: "#fee2e2", critical: "#ffedd5", major: "#fef3c7",
    normal: "#e5e7eb", minor: "#dbeafe", trivial: "#f3f4f6",
  };
  const STATUS_LABEL: Record<string, string> = {
    open: "Open", in_progress: "In Progress", resolved: "Resolved",
    closed: "Closed", reopened: "Reopened",
  };
  const STATUS_COLOR: Record<string, string> = {
    open: "#dc2626", in_progress: "#2563eb", resolved: "#16a34a",
    closed: "#6b7280", reopened: "#ca8a04",
  };

  const sevColor = SEV_COLOR[defect.severity] ?? "#6b7280";
  const sevBg = SEV_BG[defect.severity] ?? "#f3f4f6";
  const statusColor = STATUS_COLOR[defect.status] ?? "#6b7280";
  const statusLabel = STATUS_LABEL[defect.status] ?? defect.status;

  const screenshotBlock = attachments.length > 0
    ? `<div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px">
        ${attachments.map((url) => mediaHtml(url, `alt="attachment" style="max-width:300px;max-height:220px;border:1px solid #ddd;border-radius:4px"`)).join("")}
      </div>`
    : "";

  // Template integration
  const dtmpl = isReportTemplateEnabled() ? loadReportTemplateCfg() : null;
  const dt = dtmpl?.defect;
  const docTitleDefect = dt?.docTitle ?? "DEFECT REPORT";
  const secD = (key: keyof NonNullable<typeof dt>["sections"], fallback: string): string | null =>
    dt ? (dt.sections[key].enabled ? dt.sections[key].title : null) : fallback;

  const hDHeader  = secD("header",      "Заголовок");
  const hDGeneral = secD("general",     "1. Общая информация");
  const hDSteps   = secD("steps",       "2. Шаги воспроизведения");
  const hDExp     = secD("expected",    "3. Ожидаемый / фактический результат");
  const hDScreens = secD("screenshots", "Скриншоты / вложения");
  const hDSig     = secD("signatures",  "Подписи");

  const defSigRows = (cfg.signaturesDefect ?? [
    { role: "QA инженер", name: "" },
    { role: "Руководитель подразделения / PM", name: "" },
    { role: "Разработчик", name: "" },
    { role: "Лид разработки / Tech Lead", name: "" },
  ]).map((s) => `<tr><td>${escHtml(s.role)}</td><td>${escHtml(s.name)}</td><td>${fmtDate(now.toISOString())}</td><td></td></tr>`).join("");

  return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><title>${docTitleDefect} — ${displayId}</title>
<style>
  ${BASE_STYLE}
  h1{font-size:16px}
  .dr-badge{display:inline-block;padding:3px 12px;border-radius:99px;font-size:12px;font-weight:700}
</style></head>
<body><div class="page">
  ${hDHeader !== null ? `
  <h1>${docTitleDefect}</h1>
  <div class="subtitle">${displayId} — ${escHtml(defect.title)}</div>
  <div class="doc-date">Сформирован: ${nowStr}</div>
  ` : ""}

  ${hDGeneral !== null ? `
  <h2>${hDGeneral}</h2>
  <table class="info">
    ${cfg.productName ? `<tr><td>Продукт</td><td>${escHtml(cfg.productName)}</td></tr>` : ""}
    <tr><td>ID дефекта</td><td>${escHtml(displayId)}</td></tr>
    <tr><td>Заголовок</td><td><strong>${escHtml(defect.title)}</strong></td></tr>
    <tr><td>Severity</td>
      <td><span class="dr-badge" style="background:${sevBg};color:${sevColor}">${defect.severity.charAt(0).toUpperCase() + defect.severity.slice(1)}</span></td>
    </tr>
    <tr><td>Статус</td>
      <td><span class="dr-badge" style="background:#f3f4f6;color:${statusColor}">${statusLabel}</span></td>
    </tr>
    ${defect.environment ? `<tr><td>Окружение</td><td>${escHtml(defect.environment)}</td></tr>` : ""}
    ${defect.impact ? `<tr><td>Impact</td><td>${escHtml(defect.impact)}</td></tr>` : ""}
    <tr><td>Дата создания</td><td>${fmtDate(defect.created_at, true)}</td></tr>
    ${defect.updated_at ? `<tr><td>Последнее обновление</td><td>${fmtDate(defect.updated_at, true)}</td></tr>` : ""}
    ${defect.tags && defect.tags.length > 0 ? `<tr><td>Теги</td><td>${defect.tags.map((t) => escHtml(t)).join(", ")}</td></tr>` : ""}
  </table>
  ${defect.description ? `<h2>2. Описание</h2><div class="conclusion">${escHtml(defect.description)}</div>` : ""}
  ` : ""}

  ${hDSteps !== null && defect.steps_to_reproduce ? `
  <h2>${hDSteps}</h2>
  <div style="background:#f8f9fa;border:1px solid #dde1e7;border-radius:4px;padding:12px 16px;font-size:12.5px;white-space:pre-wrap;line-height:1.7">${escHtml(defect.steps_to_reproduce)}</div>
  ` : ""}

  ${hDExp !== null ? `
  ${defect.expected_result ? `<h2>${hDExp}</h2>
  <div class="ok-box">${escHtml(defect.expected_result)}</div>` : ""}
  ${defect.actual_result ? `<h2>4. Фактический результат</h2>
  <div class="defect-box">${escHtml(defect.actual_result)}</div>` : ""}
  ` : ""}

  ${hDScreens !== null && screenshotBlock ? `
  <h2>${hDScreens}</h2>
  ${screenshotBlock}
  ` : ""}

  ${hDSig !== null ? `
  <h2>${hDSig}</h2>
  <table class="sign">
    <thead><tr><th>Должность</th><th>ФИО</th><th>Дата</th><th>Подпись</th></tr></thead>
    <tbody>${defSigRows}</tbody>
  </table>
  ` : ""}

  <div class="footer">Сформировано системой 4QA TMS · ${nowStr}</div>
</div></body></html>`;
}

// ── Download / Print helpers ──────────────────────────────────────────────────

export function downloadProtocol(
  run: TestRun,
  results: TestResult[],
  casesMap: Record<string, TestCase>,
  suites: TestSuite[],
  attachmentsMap: Record<string, Record<number, string[]>> = {},
) {
  const html = generateProtocolHTML(run, results, casesMap, suites, attachmentsMap);
  const safe = sanitizeFilename(run.name);
  downloadHTML(html, `protocol_${safe}.html`);
}

export function downloadAct(run: TestRun, results: TestResult[], casesMap: Record<string, TestCase>, suites: TestSuite[], planName?: string | null) {
  const html = generateActHTML(run, results, casesMap, suites, planName);
  const safe = sanitizeFilename(run.name);
  downloadHTML(html, `act_${safe}.html`);
}

export function downloadDefectReport(defect: DefectForReport, attachments: string[] = []) {
  const html = generateDefectReportHTML(defect, attachments);
  const displayId = defect.display_id ?? `defect_${defect.id.slice(0, 8)}`;
  downloadHTML(html, `defect_report_${displayId}.html`);
}

export function downloadHTML(html: string, filename: string) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function printHTML(html: string) {
  const printable = html.replace("</body>", "<script>window.onload=()=>{window.focus();window.print();}<\/script></body>");
  const w = window.open("", "_blank");
  if (!w) return;
  w.document.write(printable);
  w.document.close();
}

// ── Word-compatible DOC export ────────────────────────────────────────────────
// Creates a Word-compatible HTML file (.doc) that opens and is editable in
// Microsoft Word and LibreOffice. No external npm packages required.

function htmlToWordDoc(html: string): string {
  // Extract body content and styles from the report HTML
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  const styleMatch = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  const bodyContent = bodyMatch?.[1] ?? html;
  const styles = styleMatch?.[1] ?? "";

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<meta name=ProgId content=Word.Document>
<meta name=Generator content="4QA TMS">
<meta name=Originator content="4QA TMS">
<!--[if gte mso 9]>
<xml>
  <w:WordDocument>
    <w:View>Print</w:View>
    <w:Zoom>100</w:Zoom>
    <w:DoNotOptimizeForBrowser/>
  </w:WordDocument>
</xml>
<![endif]-->
<style>
  /* Word-specific page setup */
  @page { size: A4; margin: 20mm 20mm 20mm 20mm; }
  @page Section1 { size:595.45pt 841.7pt; margin:56.7pt 56.7pt 56.7pt 56.7pt; }
  div.Section1 { page:Section1; }
  /* Original styles */
  ${styles}
  /* Word overrides */
  body { font-family: "Times New Roman", serif; font-size: 12pt; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #999; padding: 5pt 8pt; font-size: 10pt; }
  h1, h2 { font-family: "Arial", sans-serif; }
  .page { margin: 0; padding: 0; box-shadow: none; }
</style>
</head>
<body>
<div class=Section1>
${bodyContent}
</div>
</body>
</html>`;
}

export function downloadAsDoc(html: string, filename: string) {
  const docContent = htmlToWordDoc(html);
  const blob = new Blob(["﻿", docContent], {
    type: "application/msword;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/\.(html?|docx?)$/i, "") + ".doc";
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadProtocolDoc(
  run: TestRun,
  results: TestResult[],
  casesMap: Record<string, TestCase>,
  suites: TestSuite[],
  attachmentsMap: Record<string, Record<number, string[]>> = {},
  projectName?: string,
) {
  const html = generateProtocolHTML(run, results, casesMap, suites, attachmentsMap, projectName);
  downloadAsDoc(html, `protocol_${sanitizeFilename(run.name)}.doc`);
}

export function downloadActDoc(
  run: TestRun,
  results: TestResult[],
  casesMap: Record<string, TestCase>,
  suites: TestSuite[],
  planName?: string | null,
) {
  const html = generateActHTML(run, results, casesMap, suites, planName);
  downloadAsDoc(html, `act_${sanitizeFilename(run.name)}.doc`);
}

export function downloadDefectReportDoc(defect: DefectForReport, attachments: string[] = []) {
  const html = generateDefectReportHTML(defect, attachments);
  const displayId = defect.display_id ?? `defect_${defect.id.slice(0, 8)}`;
  downloadAsDoc(html, `defect_report_${displayId}.doc`);
}
