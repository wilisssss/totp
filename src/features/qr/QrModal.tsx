import { useEffect, useState } from "react";

import { api, errorMessage } from "../../api/tauri";
import type { EntryView } from "../../api/types";
import { Modal } from "../../components/ui/Modal";
import { CheckIcon, CopyIcon } from "../../components/ui/icons";
import { useToast } from "../../components/ui/Toast";
import { useVault } from "../vault/VaultProvider";

/** Full screen QR of the entry's `otpauth://` URI (for moving to a phone). */
export function QrModal({ entry, onClose }: { entry: EntryView; onClose: () => void }) {
  const { busy } = useVault();
  const notify = useToast();

  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const [qr, revealed] = await Promise.all([
          api.entryQr(entry.id),
          api.revealSecret(entry.id),
        ]);
        if (!cancelled) {
          setDataUrl(qr);
          setSecret(revealed);
        }
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [entry.id]);

  const title = entry.issuer || entry.account || "(tanpa nama)";

  const copyValue = async (value: string, what: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      notify(`${what} disalin`, "success");
      window.setTimeout(() => setCopied(null), 1500);
    } catch {
      notify(`Gagal menyalin ${what.toLowerCase()}`, "error");
    }
  };

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

        {/* Everything the QR encodes, spelled out — so it is easy to verify
            what the other app will receive (and where a missing account name
            comes from when the scanner shows only the provider). */}
        <div className="space-y-1.5 rounded-xl border border-zinc-200 p-3 text-left dark:border-zinc-800">
          <DetailRow
            label="Penyedia"
            value={entry.issuer || "—"}
            canCopy={entry.issuer.length > 0}
            copied={copied === "Penyedia"}
            onCopy={() => void copyValue(entry.issuer, "Penyedia")}
          />
          <DetailRow
            label="Nama akun"
            value={entry.account || "—"}
            canCopy={entry.account.length > 0}
            copied={copied === "Nama akun"}
            onCopy={() => void copyValue(entry.account, "Nama akun")}
          />
          <DetailRow
            label="Secret"
            value={secret ?? (error ? "—" : "…")}
            mono
            canCopy={secret !== null}
            copied={copied === "Secret"}
            onCopy={() => secret && void copyValue(secret, "Secret")}
          />
        </div>

        {entry.account ? null : (
          <p className="text-[13px] leading-relaxed text-amber-600 dark:text-amber-400">
            Nama akun masih kosong, jadi aplikasi lain hanya menampilkan penyedianya. Tambahkan
            lewat tombol <span className="font-semibold">Ubah</span> pada kartu akun ini.
          </p>
        )}

        <p className="text-[13px] leading-relaxed text-zinc-400 dark:text-zinc-500">
          Pindai QR ini untuk memindahkan akun ke aplikasi lain. QR berisi secret — jangan
          bagikan ke orang lain.
        </p>
      </div>
    </Modal>
  );
}

interface DetailRowProps {
  label: string;
  value: string;
  mono?: boolean;
  canCopy: boolean;
  copied: boolean;
  onCopy: () => void;
}

function DetailRow({ label, value, mono = false, canCopy, copied, onCopy }: DetailRowProps) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="flex min-w-0 items-center gap-1">
        <span
          className={`truncate text-xs ${mono ? "font-mono" : ""} text-zinc-900 dark:text-zinc-100`}
          title={value}
        >
          {value}
        </span>
        {canCopy ? (
          <button
            type="button"
            className="btn btn-ghost btn-icon shrink-0"
            onClick={onCopy}
            title={`Salin ${label.toLowerCase()}`}
            aria-label={`Salin ${label.toLowerCase()}`}
          >
            {copied ? (
              <CheckIcon size={12} className="text-emerald-500" />
            ) : (
              <CopyIcon size={12} className="text-zinc-400" />
            )}
          </button>
        ) : null}
      </span>
    </div>
  );
}
