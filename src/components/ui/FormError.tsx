import { AlertIcon } from "./icons";

/** Shared inline error box used by the forms/modals. */
export function FormError({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
      <AlertIcon size={14} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  );
}
