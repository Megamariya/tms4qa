// Вложения (скриншоты/видео/файлы) хранятся в MinIO; в сущностях — относительные ссылки
// вида /api/v1/attachments/{id}/file/{name}. В localStorage вложения НЕ кладём.
import { attachmentsApi, defectsApi, runsApi, tokenStore } from "../api/client";

export type MediaKind = "image" | "video" | "file";

const FILE_URL_RE = /\/api\/v1\/attachments\/[0-9a-fA-F-]{36}\/file/;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;
const VIDEO_EXT = /\.(mp4|webm|ogv|ogg|mov|m4v|mkv)$/i;

export const MEDIA_ACCEPT = "image/*,video/*,application/pdf";

export function mediaKind(url: string): MediaKind {
  if (url.startsWith("data:")) {
    if (url.startsWith("data:image/")) return "image";
    if (url.startsWith("data:video/")) return "video";
    return "file";
  }
  const path = decodeURIComponent(url.split("?")[0]);
  if (VIDEO_EXT.test(path)) return "video";
  if (IMAGE_EXT.test(path)) return "image";
  // старые ссылки без имени файла (/file) — считаем картинкой
  return /\/file$/.test(path) ? "image" : "file";
}

export function mediaName(url: string): string {
  if (url.startsWith("data:")) {
    const m = url.match(/;name=([^;,]*)/);
    return m ? decodeURIComponent(m[1]) : "attachment";
  }
  return decodeURIComponent(url.split("?")[0].split("/").pop() || "file");
}

/**
 * Относительные ссылки → абсолютные (для HTML, открытого из blob:/about:blank — превью и печать
 * отчётов, где относительный путь не резолвится).
 */
export function absolutizeMedia<T>(value: T): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return v.startsWith("/api/v1/attachments/") ? window.location.origin + v : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}

/** Загружает файлы в MinIO и возвращает их ссылки (порядок сохраняется). */
export async function uploadMedia(
  files: File[], entityType: string, entityId: string, projectId: string,
): Promise<string[]> {
  const urls: string[] = [];
  for (const f of files) {
    const att = await attachmentsApi.upload(f, entityType, entityId, projectId);
    urls.push(att.url);
  }
  return urls;
}

async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const name = mediaName(url);
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  // имя файла сохраняем в параметре data-URL — бэкенд при импорте его подхватит
  return dataUrl.replace(/^data:([^;,]*)/, `data:$1;name=${encodeURIComponent(name)}`);
}

/**
 * Рекурсивно заменяет ссылки на файлы MinIO на data-URL — для самодостаточных
 * экспортов (бэкап проекта, HTML-протоколы), которые открываются на другой машине.
 * Недоступный файл оставляется ссылкой.
 */
export async function inlineMedia<T>(value: T): Promise<T> {
  const cache = new Map<string, Promise<string>>();
  const walk = async (v: unknown): Promise<unknown> => {
    if (typeof v === "string") {
      if (!FILE_URL_RE.test(v)) return v;
      if (!cache.has(v)) cache.set(v, urlToDataUrl(v).catch(() => v));
      return cache.get(v);
    }
    if (Array.isArray(v)) return Promise.all(v.map(walk));
    if (v && typeof v === "object") {
      const entries = await Promise.all(Object.entries(v).map(async ([k, x]) => [k, await walk(x)] as const));
      return Object.fromEntries(entries);
    }
    return v;
  };
  return (await walk(value)) as T;
}

/**
 * Одноразовый перенос вложений, которые старые версии клали в localStorage:
 * - defect_attachments_<id> — существовали ТОЛЬКО в браузере → отправляем на бэкенд (он кладёт в MinIO);
 * - exec_attach_<resultId> — обычно копия test_results.attachments, но старый ExecutionDrawer при
 *   ошибке сохранения молча оставлял файлы только здесь. Если в БД у результата вложений нет
 *   (именно тогда старый UI показывал localStorage) — отправляем на бэкенд, иначе просто удаляем.
 */
export async function migrateLegacyLocalAttachments(): Promise<void> {
  if (!tokenStore.getAccess()) return;
  let keys: string[];
  try { keys = Object.keys(localStorage); } catch { return; }

  for (const key of keys.filter((k) => k.startsWith("exec_attach_"))) {
    const resultId = key.slice("exec_attach_".length);
    try {
      const local: Record<string, string[]> = JSON.parse(localStorage.getItem(key) ?? "{}");
      const hasLocal = Object.values(local).some((v) => Array.isArray(v) && v.length);
      if (hasLocal) {
        const current = await runsApi.setResult(resultId, {}); // пустой PATCH — только прочитать
        const hasRemote = Object.values(current.attachments ?? {}).some((v) => Array.isArray(v) && v.length);
        if (!hasRemote) await runsApi.setResult(resultId, { attachments: local });
      }
      localStorage.removeItem(key);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("API 404")) localStorage.removeItem(key);
    }
  }
  for (const key of keys.filter((k) => k.startsWith("defect_attachments_"))) {
    const defectId = key.slice("defect_attachments_".length);
    try {
      const local: string[] = JSON.parse(localStorage.getItem(key) ?? "[]");
      if (local.length) {
        const defect = await defectsApi.get(defectId);
        const merged = [...(defect.attachments ?? []), ...local.filter((u) => !(defect.attachments ?? []).includes(u))];
        await defectsApi.update(defectId, { attachments: merged });
      }
      localStorage.removeItem(key);
    } catch (e) {
      // дефект удалён — ключ больше не нужен; иначе попробуем при следующем запуске
      if (e instanceof Error && e.message.startsWith("API 404")) localStorage.removeItem(key);
    }
  }
}

