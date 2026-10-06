import { useEffect, useMemo, useRef, useState } from "react";

import { api, errorMessage } from "../../api/tauri";
import type { EntryView } from "../../api/types";
import { Modal } from "../../components/ui/Modal";
import {
  CheckIcon,
  LockIcon,
  PlusIcon,
  SearchIcon,
  SettingsIcon,
  ShieldIcon,
  SwapIcon,
  TrashIcon,
  UploadIcon,
} from "../../components/ui/icons";
import { useToast } from "../../components/ui/Toast";
import { formatDuration, matchesQuery } from "../../lib/format";
import { EntryCard } from "../entries/EntryCard";
import { EntryFormModal } from "../entries/EntryFormModal";
import { ImportModal } from "../import/ImportModal";
import { QrModal } from "../qr/QrModal";
import { SettingsModal } from "../settings/SettingsModal";
import { useVault } from "../vault/VaultProvider";

type ModalState =
  | { type: null }
  | { type: "add" }
  | { type: "edit"; entry: EntryView }
  | { type: "import" }
  | { type: "settings" }
  | { type: "qr"; entry: EntryView };

type SortMode = "default" | "az" | "za" | "newest" | "oldest";

const SORT_LABELS: Record<SortMode, string> = {
  default: "Urutan manual",
  az: "Nama A → Z",
  za: "Nama Z → A",
  newest: "Terbaru ditambahkan",
  oldest: "Terlama ditambahkan",
};

const SORT_MODES = Object.keys(SORT_LABELS) as SortMode[];

const SORT_STORAGE_KEY = "totp.sort";

const loadSortMode = (): SortMode => {
  const saved = window.localStorage.getItem(SORT_STORAGE_KEY);
  return saved && saved in SORT_LABELS ? (saved as SortMode) : "default";
};

export function MainScreen() {
  const { snapshot, settings, lock, refresh } = useVault();
  const notify = useToast();

  const [query, setQuery] = useState("");
  const [modal, setModal] = useState<ModalState>({ type: null });
  const [pendingDelete, setPendingDelete] = useState<EntryView | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>(loadSortMode);
  const [sortOpen, setSortOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const entries = snapshot?.entries ?? [];
  const visible = useMemo(() => {
    const filtered = entries.filter((entry) => matchesQuery(entry, query));
    if (sortMode === "default") return filtered;

    const label = (entry: EntryView) =>
      `${entry.issuer} ${entry.account}`.trim().toLowerCase() || entry.id;
    const byName = (a: EntryView, b: EntryView) => label(a).localeCompare(label(b));
    const byTime = (a: EntryView, b: EntryView) => a.created_at - b.created_at;
    const compare =
      sortMode === "az"
        ? byName
        : sortMode === "za"
          ? (a: EntryView, b: EntryView) => byName(b, a)
          : sortMode === "newest"
            ? (a: EntryView, b: EntryView) => byTime(b, a)
            : byTime;

    // Pinned entries stay on top; each group is sorted independently.
    // (filter already returned fresh arrays, so in-place sort is safe.)
    const pinned = filtered.filter((entry) => entry.pinned).sort(compare);
    const rest = filtered.filter((entry) => !entry.pinned).sort(compare);
    return [...pinned, ...rest];
  }, [entries, query, sortMode]);

  // Manual reorder only makes sense in the default, unfiltered view.
  const reorderDisabled = query.trim().length > 0 || sortMode !== "default";

  const applySort = (mode: SortMode) => {
    setSortMode(mode);
    window.localStorage.setItem(SORT_STORAGE_KEY, mode);
    setSortOpen(false);
  };

  const close = () => setModal({ type: null });

  // Keyboard shortcuts (ignored while a modal is open):
  // Ctrl+F search, Ctrl+N add, Ctrl+L lock.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (modal.type !== null || pendingDelete) return;

      const key = event.key.toLowerCase();
      if (key === "f") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (key === "n") {
        event.preventDefault();
        setModal({ type: "add" });
      } else if (key === "l") {
        event.preventDefault();
        void handleLock();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modal.type, pendingDelete, lock, notify]);

  const move = async (entry: EntryView, direction: -1 | 1) => {
    const ids = entries.map((item) => item.id);
    const from = ids.indexOf(entry.id);
    const to = from + direction;

    if (from < 0) return;
    if (to < 0 || to >= ids.length) {
      notify("Sudah berada di urutan paling atas/bawah", "info");
      return;
    }

    [ids[from], ids[to]] = [ids[to]!, ids[from]!];

    try {
      await api.reorderEntries(ids);
      await refresh();
    } catch (caught) {
      notify(errorMessage(caught), "error");
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.deleteEntry(pendingDelete.id);
      await refresh();
      notify("Entri dihapus", "success");
      setPendingDelete(null);
    } catch (caught) {
      notify(errorMessage(caught), "error");
    } finally {
      setDeleting(false);
    }
  };

  const handleLock = async () => {
    try {
      await lock();
    } catch (caught) {
      notify(errorMessage(caught), "error");
    }
  };

  const offset = settings?.offset_secs ?? 0;

  return (
    <div className="flex h-full flex-col">
      <header
        data-tauri-drag-region
        className="flex shrink-0 items-center gap-2 border-b border-zinc-200 bg-white/80 px-3 py-2.5 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80"
      >
        <div className="flex shrink-0 items-center gap-2" data-tauri-drag-region>
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <ShieldIcon size={15} />
          </div>
          <span className="text-sm font-semibold tracking-tight">TOTP</span>
          {offset !== 0 ? (
            <span
              className="rounded-md bg-amber-100 px-1.5 py-0.5 text-[12px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300"
              title="Koreksi jam terhadap server waktu"
            >
              {offset > 0 ? "+" : ""}
              {offset}s
            </span>
          ) : null}
        </div>

        <div className="relative ml-auto min-w-0 flex-1 sm:max-w-[180px]">
          <SearchIcon
            size={13}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400"
          />
          <input
            ref={searchRef}
            className="field !py-1.5 !pl-7 !text-xs"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Cari... (Ctrl+F)"
            aria-label="Cari akun"
          />
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            className="btn btn-ghost !gap-1.5 !px-2 !py-1.5 !text-xs"
            onClick={() => setSortOpen((open) => !open)}
            title="Urutkan akun"
            aria-label="Urutkan akun"
            aria-expanded={sortOpen}
          >
            <SwapIcon size={13} />
            <span className="hidden md:inline">{SORT_LABELS[sortMode]}</span>
          </button>

          {sortOpen ? (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setSortOpen(false)} />
              <div className="absolute right-0 top-full z-50 mt-1 w-48 space-y-0.5 rounded-xl border border-zinc-200 bg-white p-1 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
                {SORT_MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    onClick={() => applySort(mode)}
                  >
                    <span
                      className={
                        mode === sortMode
                          ? "font-semibold text-indigo-600 dark:text-indigo-400"
                          : ""
                      }
                    >
                      {SORT_LABELS[mode]}
                    </span>
                    {mode === sortMode ? (
                      <CheckIcon size={13} className="text-indigo-600 dark:text-indigo-400" />
                    ) : null}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => setModal({ type: "import" })}
            title="Impor"
            aria-label="Impor"
          >
            <UploadIcon size={15} />
          </button>
          <button
            type="button"
            className="btn btn-primary btn-icon"
            onClick={() => setModal({ type: "add" })}
            title="Tambah akun (Ctrl+N)"
            aria-label="Tambah akun"
          >
            <PlusIcon size={15} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => setModal({ type: "settings" })}
            title="Pengaturan"
            aria-label="Pengaturan"
          >
            <SettingsIcon size={15} />
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={handleLock}
            title="Kunci vault (Ctrl+L)"
            aria-label="Kunci vault"
          >
            <LockIcon size={15} />
          </button>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto p-3">
        {entries.length === 0 ? (
          <div className="mx-auto mt-10 max-w-sm space-y-3 rounded-2xl border border-dashed border-zinc-300 p-6 text-center dark:border-zinc-700">
            <h2 className="text-sm font-semibold">Belum ada akun</h2>
            <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
              Tambahkan akun manual, tempel URI <span className="font-mono">otpauth://</span>,
              atau impor gambar QR code.
            </p>
            <div className="flex justify-center gap-2 pt-1">
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => setModal({ type: "add" })}
              >
                <PlusIcon size={14} /> Tambah akun
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setModal({ type: "import" })}
              >
                <UploadIcon size={14} /> Impor
              </button>
            </div>
          </div>
        ) : visible.length === 0 ? (
          <p className="mt-10 text-center text-xs text-zinc-500 dark:text-zinc-400">
            Tidak ada akun yang cocok dengan “{query}”.
          </p>
        ) : (
          // Responsive card grid: every card is capped by its column, so
          // accounts tile side by side instead of one full-width row each.
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[repeat(auto-fill,minmax(330px,1fr))]">
            {visible.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                total={entries.length}
                moveDisabled={reorderDisabled}
                onEdit={(target) => setModal({ type: "edit", entry: target })}
                onDelete={(target) => setPendingDelete(target)}
                onShowQr={(target) => setModal({ type: "qr", entry: target })}
                onMove={(target, direction) => void move(target, direction)}
              />
            ))}
          </div>
        )}
      </main>

      <footer className="flex shrink-0 items-center justify-between border-t border-zinc-200 bg-white/60 px-3 py-2 text-[13px] text-zinc-400 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/60 dark:text-zinc-500">
        <span>{entries.length} akun</span>
        <span>Kunci otomatis {formatDuration(settings?.autolock_secs ?? 0).toLowerCase()}</span>
      </footer>

      {modal.type === "add" ? <EntryFormModal entry={null} onClose={close} /> : null}
      {modal.type === "edit" ? <EntryFormModal entry={modal.entry} onClose={close} /> : null}
      {modal.type === "import" ? <ImportModal onClose={close} /> : null}
      {modal.type === "settings" ? <SettingsModal onClose={close} /> : null}
      {modal.type === "qr" ? <QrModal entry={modal.entry} onClose={close} /> : null}

      {pendingDelete ? (
        <Modal
          title="Hapus akun"
          onClose={() => setPendingDelete(null)}
          footer={
            <>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
              >
                Batal
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => void confirmDelete()}
                disabled={deleting}
              >
                <TrashIcon size={14} /> {deleting ? "Menghapus..." : "Hapus"}
              </button>
            </>
          }
        >
          <p className="text-sm leading-relaxed">
            Hapus{" "}
            <strong className="font-semibold">
              {pendingDelete.issuer || pendingDelete.account}
            </strong>
            ? Entri beserta secret-nya akan dihapus dari vault dan tidak dapat dipulihkan.
          </p>
        </Modal>
      ) : null}
    </div>
  );
}
