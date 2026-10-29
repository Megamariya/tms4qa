import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import "./Toast.css";

type Variant = "success" | "error" | "info";

interface ToastItem {
  id: number;
  variant: Variant;
  text: string;
}

interface Ctx {
  show: (text: string, variant?: Variant) => void;
  success: (text: string) => void;
  error: (text: string) => void;
}

const ToastContext = createContext<Ctx | null>(null);

export function useToast(): Ctx {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const remove = useCallback((id: number) => {
    setItems((arr) => arr.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (text: string, variant: Variant = "info") => {
      const id = Date.now() + Math.random();
      setItems((arr) => [...arr, { id, text, variant }]);
      setTimeout(() => remove(id), 3500);
    },
    [remove]
  );

  const ctx: Ctx = {
    show,
    success: (t) => show(t, "success"),
    error: (t) => show(t, "error"),
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      {createPortal(
        <div className="toast-stack">
          {items.map((t) => (
            <ToastView key={t.id} item={t} onClose={() => remove(t.id)} />
          ))}
        </div>,
        document.body
      )}
    </ToastContext.Provider>
  );
}

function ToastView({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setLeaving(true), 3200);
    return () => clearTimeout(t);
  }, []);
  const icon = item.variant === "success" ? "✓" : item.variant === "error" ? "⚠" : "ℹ";
  return (
    <div
      className={`toast toast-${item.variant}` + (leaving ? " is-leaving" : "")}
      onClick={onClose}
      role="status"
    >
      <span className="toast-icon">{icon}</span>
      <span className="toast-text">{item.text}</span>
    </div>
  );
}
