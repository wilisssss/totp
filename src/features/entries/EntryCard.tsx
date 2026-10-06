import { useState } from "react";

import { api, errorMessage } from "../../api/tauri";
import type { EntryView } from "../../api/types";
import { copyText } from "../../lib/clipboard";
import {
  formatCode,
  formatRemaining,
  hueFor,
  initials,
  windowProgress,
} from "../../lib/format";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  CopyIcon,
  PencilIcon,
  PinIcon,
  QrIcon,
  RefreshIcon,
  TrashIcon,
} from "../../components/ui/icons";
import { useToast } from "../../components/ui/Toast";
import { useVault } from "../vault/VaultProvider";

interface EntryCardProps {
  entry: EntryView;
  total: number;
  onEdit: (entry: EntryView) => void;
  onDelete: (entry: EntryView) => void;
  onShowQr: (entry: EntryView) => void;
  onMove: (entry: EntryView, direction: -1 | 1) => void;
}

export function EntryCard({
  entry,
  total,
  onEdit,
  onDelete,
  onShowQr,
  onMove,
}: EntryCardProps) {
  const notify = useToast();
  const { refresh } = useVault();

  const [copied, setCopied] = useState(false);

  const isTotp = entry.kind === "totp";
  const urgent = isTotp && entry.remaining <= 5;
  const progress = isTotp ? windowProgress(entry.remaining, entry.period) : 0;
  const title = entry.issuer || entry.account || "(tanpa nama)";
  const subtitle = entry.issuer
    ? entry.account || entry.kind.toUpperCase()
    : entry.kind.toUpperCase();

  const handleCopy = async () => {
    const ok = await copyText(entry.code);
    if (!ok) {
      notify("Gagal menyalin kode", "error");
      return;
    }
    setCopied(true);
    notify("Kode disalin", "success");
    window.setTimeout(() => setCopied(false), 1500);
  };

  const handlePin = async () => {
    try {
      await api.togglePin(entry.id);
      await refresh();
    } catch (caught) {
      notify(errorMessage(caught), "error");
    }
  };

  const handleNext = async () => {
    try {
      await api.hotpNext(entry.id);
      await refresh();
    } catch (caught) {
      notify(errorMessage(caught), "error");
    }
  };

  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700">
      <div className="flex items-start gap-3">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-semibold text-white"
          style={{ backgroundColor: `hsl(${hueFor(title)} 58% 42%)` }}
        >
          {initials(entry.issuer, entry.account)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-sm font-semibold tracking-tight" title={title}>
              {title}
            </h3>
            {entry.kind === "hotp" ? (
              <span className="shrink-0 rounded-md bg-zinc-100 px-1.5 py-0.5 text-[12px] font-semibold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                HOTP
              </span>
            ) : null}
            {entry.pinned ? (
              <PinIcon size={12} className="shrink-0 text-indigo-500" fill="currentColor" />
            ) : null}
          </div>
          <p className="truncate text-xs text-zinc-500 dark:text-zinc-400" title={subtitle}>
            {subtitle}
          </p>
        </div>

        {isTotp ? (
          <span
            className={`shrink-0 pt-0.5 text-xs tabular-nums ${urgent ? "font-semibold text-red-500" : "text-zinc-400"}`}
            title="Waktu tersisa"
          >
            {formatRemaining(entry.remaining)}
          </span>
        ) : (
          <button
            type="button"
            className="btn btn-ghost btn-icon shrink-0"
            onClick={handleNext}
            title="Ambil kode berikutnya"
            aria-label="Ambil kode berikutnya"
          >
            <RefreshIcon size={14} />
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={handleCopy}
        className="mt-3 flex w-full items-center justify-between gap-3 rounded-xl bg-zinc-50 px-3.5 py-2.5 transition-colors hover:bg-zinc-100 dark:bg-zinc-950/70 dark:hover:bg-zinc-800"
        title="Salin kode"
      >
        <span className="otp-code text-2xl leading-none text-zinc-900 dark:text-zinc-50">
          {formatCode(entry.code)}
        </span>
        {copied ? (
          <CheckIcon size={16} className="text-emerald-500" />
        ) : (
          <CopyIcon size={16} className="text-zinc-400" />
        )}
      </button>

      {isTotp ? (
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800">
          <div
            className={`h-full rounded-full transition-[width] duration-1000 ease-linear ${
              urgent ? "bg-red-500" : "bg-indigo-500"
            }`}
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="truncate text-[12px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
          {entry.algorithm} · {entry.digits} digit
          {isTotp ? ` · ${entry.period}s` : ` · #${entry.counter}`}
        </span>

        <div className="flex shrink-0 items-center gap-0.5">
          {total > 1 ? (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => onMove(entry, -1)}
                title="Naikkan"
                aria-label="Naikkan"
              >
                <ArrowUpIcon size={13} />
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => onMove(entry, 1)}
                title="Turunkan"
                aria-label="Turunkan"
              >
                <ArrowDownIcon size={13} />
              </button>
            </>
          ) : null}

          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={handlePin}
            title={entry.pinned ? "Lepas pin" : "Pin"}
            aria-label={entry.pinned ? "Lepas pin" : "Pin"}
          >
            <PinIcon size={13} className={entry.pinned ? "text-indigo-500" : ""} />
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => onShowQr(entry)}
            title="Tampilkan QR"
            aria-label="Tampilkan QR"
          >
            <QrIcon size={13} />
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => onEdit(entry)}
            title="Ubah"
            aria-label="Ubah"
          >
            <PencilIcon size={13} />
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-icon hover:!border-red-300 hover:text-red-600 dark:hover:!border-red-800"
            onClick={() => onDelete(entry)}
            title="Hapus"
            aria-label="Hapus"
          >
            <TrashIcon size={13} />
          </button>
        </div>
      </div>
    </article>
  );
}
