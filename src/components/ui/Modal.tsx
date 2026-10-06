import { useEffect } from "react";
import type { ReactNode } from "react";

import { XIcon } from "./icons";

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

/** Shared dialog shell: overlay click and Escape both close it. */
export function Modal({ title, onClose, children, footer, wide = false }: ModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/55 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`my-8 w-full ${wide ? "max-w-2xl" : "max-w-md"} overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-900`}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3.5 dark:border-zinc-800">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            aria-label="Tutup"
          >
            <XIcon size={15} />
          </button>
        </div>

        <div className="px-5 py-4">{children}</div>

        {footer ? (
          <div className="flex justify-end gap-2 border-t border-zinc-200 bg-zinc-50 px-5 py-3.5 dark:border-zinc-800 dark:bg-zinc-950/40">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

/** Label + control + inline validation message. */
export function Field({ label, hint, error, children }: FieldProps) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between text-xs font-medium text-zinc-600 dark:text-zinc-400">
        {label}
        {hint ? <span className="text-zinc-400 dark:text-zinc-500">{hint}</span> : null}
      </span>
      {children}
      {error ? (
        <span className="block text-xs text-red-600 dark:text-red-400">{error}</span>
      ) : null}
    </label>
  );
}
