import { useEffect, useState } from "react";

import { api, errorMessage } from "../../api/tauri";
import type { EntryView } from "../../api/types";
import { Modal } from "../../components/ui/Modal";
import { useVault } from "../vault/VaultProvider";

/** Full screen QR of the entry's `otpauth://` URI (for moving to a phone). */
export function QrModal({ entry, onClose }: { entry: EntryView; onClose: () => void }) {
  const { busy } = useVault();

  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const url = await api.entryQr(entry.id);
        if (!cancelled) setDataUrl(url);
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [entry.id]);

  const title = entry.issuer || entry.account || "(tanpa nama)";

  return (
    <Modal
      title="QR code"
      onClose={onClose}
      footer={
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
          Tutup
        </button>
      }
    >
      <div className="space-y-3 text-center">
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {entry.account || entry.kind.toUpperCase()}
        </p>

        <div className="mx-auto flex aspect-square w-full max-w-[260px] items-center justify-center rounded-2xl border border-zinc-200 bg-white p-3 dark:border-zinc-800">
          {error ? (
            <span className="px-4 text-xs text-red-600 dark:text-red-400">{error}</span>
          ) : dataUrl ? (
            <img src={dataUrl} alt={`QR untuk ${title}`} className="h-full w-full" />
          ) : (
            <span className="text-xs text-zinc-400">Membuat QR...</span>
          )}
        </div>

        <p className="text-[13px] leading-relaxed text-zinc-400 dark:text-zinc-500">
          Pindai QR ini untuk memindahkan akun ke aplikasi lain. QR berisi secret — jangan
          bagikan ke orang lain.
        </p>
      </div>
    </Modal>
  );
}
