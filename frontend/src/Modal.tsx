import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export type ModalProps = {
  open: boolean;
  labelledBy: string;
  describedBy?: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
};

export function Modal({
  open,
  labelledBy,
  describedBy,
  onClose,
  children,
  className = "",
}: ModalProps) {
  const panel = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = panel.current;
    const first = node?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? node)?.focus();
    return () => {
      opener.current?.focus();
      opener.current = null;
    };
  }, [open]);

  // On the document, not the panel: a backdrop click moves focus out of the panel, and Esc has
  // to keep working afterwards.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const trap = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const node = panel.current;
    if (!node) return;
    const stops = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (stops.length === 0) {
      event.preventDefault();
      node.focus();
      return;
    }
    const first = stops[0];
    const last = stops[stops.length - 1];
    const active = document.activeElement;
    const outside = !(active instanceof Node) || !node.contains(active);
    if (event.shiftKey && (outside || active === first || active === node)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (outside || active === last)) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      data-modal-backdrop=""
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-bunker/70 p-4 sm:p-8"
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={trap}
        className={`my-auto w-full max-w-3xl rounded-l border border-line bg-surface shadow-l focus:outline-none ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
