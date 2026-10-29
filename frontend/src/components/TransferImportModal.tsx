import { useState } from "react";
import Modal from "./Modal";
import { useToast } from "./Toast";
import { plansApi, runsApi, type TransferBundle } from "../api/client";

type Kind = "test_plan" | "test_run";

interface Props {
  open: boolean;
  kind: Kind;
  projectId: string;
  onClose: () => void;
  /** id созданного плана/прогона */
  onImported: (id: string) => void;
}

const KIND_LABEL: Record<Kind, string> = { test_plan: "тест-плана", test_run: "тест-прогона" };

function countOf(b: TransferBundle, key: string): number {
  const v = b[key];
  return Array.isArray(v) ? v.length : 0;
}

export default function TransferImportModal({ open, kind, projectId, onClose, onImported }: Props) {
  const toast = useToast();
  const [bundle, setBundle] = useState<TransferBundle | null>(null);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reuseExisting, setReuseExisting] = useState(true);
  const [includePlan, setIncludePlan] = useState(true);
  const [importing, setImporting] = useState(false);

  const reset = () => { setBundle(null); setFileName(""); setError(null); setImporting(false); };
  const close = () => { reset(); onClose(); };

  const pick = async (file: File | undefined) => {
    reset();
    if (!file) return;
    setFileName(file.name);
    try {
      const data = JSON.parse(await file.text()) as TransferBundle;
      if (data?.format !== "tms4qa-transfer") throw new Error("Это не файл экспорта TMS4QA (нет format: tms4qa-transfer)");
      if (data.kind !== kind) {
        throw new Error(`Файл содержит ${data.kind === "test_run" ? "тест-прогон" : "тест-план"}, а здесь импортируется ${kind === "test_run" ? "тест-прогон" : "тест-план"}`);
      }
      setBundle(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось прочитать файл");
    }
  };

  const doImport = async () => {
    if (!bundle) return;
    setImporting(true);
    try {
      if (kind === "test_plan") {
        const r = await plansApi.importBundle(projectId, bundle, reuseExisting);
        toast.success(`План ${r.display_id} импортирован: кейсов создано ${r.cases_created}, переиспользовано ${r.cases_reused}`);
        reset(); onImported(r.plan_id);
      } else {
        const r = await runsApi.importBundle(projectId, bundle, { reuseExisting, includePlan });
        toast.success(`Прогон импортирован: результатов ${r.results_created}, дефектов ${r.defects_created}, кейсов создано ${r.cases_created}`);
        reset(); onImported(r.run_id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Импорт не удался");
      setImporting(false);
    }
  };

  const meta = bundle
    ? kind === "test_plan"
      ? (bundle.plan as { name?: string; source_display_id?: string } | undefined)
      : (bundle.run as { name?: string } | undefined)
    : undefined;

  return (
    <Modal
      open={open}
      title={`Импорт ${KIND_LABEL[kind]}`}
      onClose={close}
      width={520}
      footer={
        <>
          <button className="btn" onClick={close}>Отмена</button>
          <button className="btn btn-primary" disabled={!bundle || importing} onClick={doImport}>
            {importing ? "Импортируем…" : "Импортировать"}
          </button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 12, fontSize: 13 }}>
        <div style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
          Выберите JSON-файл, выгруженный кнопкой «Экспорт для переноса» в другой инсталляции TMS4QA.
          Недостающие сьюты и тест-кейсы будут созданы в текущем проекте.
        </div>
        <label className="btn" style={{ alignSelf: "flex-start", cursor: "pointer" }}>
          📂 Выбрать файл…
          <input type="file" accept=".json,application/json" style={{ display: "none" }}
            onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {fileName && <div style={{ fontSize: 12, color: "var(--color-text-muted)" }}>Файл: {fileName}</div>}

        {error && (
          <div style={{ padding: "8px 12px", borderRadius: 6, background: "var(--color-failed-bg)", color: "var(--color-failed)", fontSize: 12, wordBreak: "break-word" }}>
            ⚠ {error}
          </div>
        )}

        {bundle && (
          <div style={{ padding: "10px 12px", borderRadius: 6, background: "var(--color-bg-soft)", border: "1px solid var(--color-border)", display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px", fontSize: 12 }}>
            <span style={{ color: "var(--color-text-muted)" }}>Название</span><b>{meta?.name ?? "—"}</b>
            <span style={{ color: "var(--color-text-muted)" }}>Исходный проект</span><span>{bundle.source_project ?? "—"}</span>
            <span style={{ color: "var(--color-text-muted)" }}>Экспортирован</span><span>{new Date(bundle.exported_at).toLocaleString("ru-RU")}</span>
            <span style={{ color: "var(--color-text-muted)" }}>Тест-кейсов</span><span>{countOf(bundle, "cases")}</span>
            {kind === "test_run" && (
              <>
                <span style={{ color: "var(--color-text-muted)" }}>Результатов</span><span>{countOf(bundle, "results")}</span>
                <span style={{ color: "var(--color-text-muted)" }}>Дефектов</span><span>{countOf(bundle, "defects")}</span>
                <span style={{ color: "var(--color-text-muted)" }}>Чек-листов</span><span>{countOf(bundle, "checklists")}</span>
              </>
            )}
          </div>
        )}

        {bundle && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
              <input type="checkbox" checked={reuseExisting} onChange={(e) => setReuseExisting(e.target.checked)} />
              <span>
                Переиспользовать существующие кейсы
                <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                  Кейс с тем же названием в том же сьюте не дублируется. Снимите, чтобы создать все кейсы заново.
                </div>
              </span>
            </label>
            {kind === "test_run" && !!bundle.plan && (
              <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
                <input type="checkbox" checked={includePlan} onChange={(e) => setIncludePlan(e.target.checked)} />
                <span>
                  Создать и тест-план прогона
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                    Прогон был создан из плана — план будет импортирован и связан с прогоном.
                  </div>
                </span>
              </label>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
