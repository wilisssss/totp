import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { AlertIcon, CheckIcon } from "./icons";

export type ToastKind = "info" | "success" | "error";

interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

type PushToast = (message: string, kind?: ToastKind) => void;

const ToastContext = createContext<PushToast>(() => {});

/** `const notify = useToast(); notify("Tersimpan", "success");` */
export function useToast(): PushToast {
  return useContext(ToastContext);
}

const KIND_STYLE: Record<ToastKind, string> = {
  info: "border-zinc-300 bg-white text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100",
  success:
    "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  error:
    "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200",
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const push = useCallback<PushToast>((message, kind = "info") => {
    nextId.current += 1;
    const id = nextId.current;
    setToasts((current) => [...current, { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3600);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className={`pointer-events-auto flex max-w-md items-center gap-2 rounded-xl border px-3.5 py-2 text-xs shadow-lg backdrop-blur ${KIND_STYLE[toast.kind]}`}
          >
            {toast.kind === "error" ? (
              <AlertIcon size={14} className="shrink-0" />
            ) : toast.kind === "success" ? (
              <CheckIcon size={14} className="shrink-0" />
            ) : null}
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
