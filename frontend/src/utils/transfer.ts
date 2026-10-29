// Перенос тест-плана / тест-прогона между инсталляциями TMS4QA.
// Бэкенд собирает самодостаточный бандл (format: "tms4qa-transfer"),
// здесь — только скачивание файла.
import { plansApi, runsApi, type TransferBundle } from "../api/client";
import { downloadJSON } from "./exportFormats";

function stamp(): string {
  return new Date().toISOString().slice(0, 19).replace("T", "_").replace(/:/g, "-");
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 60);
}

export async function exportPlanBundle(planId: string, displayName: string): Promise<TransferBundle> {
  const bundle = await plansApi.exportBundle(planId);
  downloadJSON(bundle, `4qa_plan_${safeName(displayName)}_${stamp()}.json`);
  return bundle;
}

export function isTransferBundle(data: unknown): data is TransferBundle {
  return !!data && typeof data === "object" && (data as TransferBundle).format === "tms4qa-transfer";
}

export type TransferImportOutcome = {
  kind: TransferBundle["kind"];
  /** путь для перехода к созданному плану/прогону */
  path: string;
  lines: string[];
};

/** Импорт бандла плана/прогона в проект; тип определяется по полю kind файла. */
export async function importTransferBundle(
  projectId: string,
  bundle: TransferBundle,
  opts: { reuseExisting?: boolean; includePlan?: boolean } = {},
): Promise<TransferImportOutcome> {
  if (bundle.kind === "test_plan") {
    const r = await plansApi.importBundle(projectId, bundle, opts.reuseExisting ?? true);
    return {
      kind: "test_plan",
      path: `/project/${projectId}/plan/${r.plan_id}`,
      lines: [
        `✓ Тест-план создан: ${r.display_id}`,
        `  сьютов создано: ${r.suites_created}`,
        `  кейсов создано: ${r.cases_created}, переиспользовано: ${r.cases_reused}`,
      ],
    };
  }
  if (bundle.kind === "test_run") {
    const r = await runsApi.importBundle(projectId, bundle, opts);
    return {
      kind: "test_run",
      path: `/project/${projectId}/run/${r.run_id}`,
      lines: [
        `✓ Тест-прогон создан`,
        ...(r.plan_id ? ["  тест-план прогона: создан"] : []),
        `  результатов: ${r.results_created}, дефектов: ${r.defects_created}, чек-листов: ${r.checklists_added}`,
        `  сьютов создано: ${r.suites_created}`,
        `  кейсов создано: ${r.cases_created}, переиспользовано: ${r.cases_reused}`,
      ],
    };
  }
  throw new Error(`Неизвестный тип экспорта: ${String(bundle.kind)}`);
}

export async function exportRunBundle(runId: string, displayName: string, includeAttachments = true): Promise<TransferBundle> {
  const bundle = await runsApi.exportBundle(runId, includeAttachments);
  downloadJSON(bundle, `4qa_run_${safeName(displayName)}_${stamp()}.json`);
  return bundle;
}
