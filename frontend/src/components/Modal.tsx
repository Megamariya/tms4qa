import { useEffect } from "react";
import { createPortal } from "react-dom";
import "./Modal.css";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  noPadding?: boolean;   // removes modal-body padding (for full-bleed layouts)
}

export default function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  width = 520,
  noPadding = false,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="modal-overlay">
      <div
        className="modal-dialog"
        style={{ width }}
        role="dialog"
        aria-modal="true"
      >
        <header className="modal-header">
          <h2 className="modal-title">{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className={`modal-body${noPadding ? " modal-body--np" : ""}`}>{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>,
    document.body
  );
}
