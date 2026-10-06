import { useState } from "react";
import type { FormEvent } from "react";

import { api, errorMessage } from "../../api/tauri";
import type { Settings, Theme } from "../../api/types";
import { copyText } from "../../lib/clipboard";
import { formatDuration } from "../../lib/format";
import { Field, Modal } from "../../components/ui/Modal";
import {
  AlertIcon,
  ClockIcon,
  CopyIcon,
  DownloadIcon,
  KeyIcon,
  RefreshIcon,
} from "../../components/ui/icons";
import { useToast } from "../../components/ui/Toast";
import { useVault } from "../vault/VaultProvider";

const AUTOLOCK_CHOICES = [0, 60, 300, 900, 3600];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { settings, saveSettings, syncClock, changePassphrase, busy } = useVault();
  const notify = useToast();

  const [changingPassphrase, setChangingPassphrase] = useState(false);
  const [oldPassphrase, setOldPassphrase] = useState("");
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  if (!settings) return null;

  const updateSetting = async <K extends keyof Settings>(key: K, value: Settings[K]) => {
    try {
      await saveSettings({ ...settings, [key]: value });
    } catch (caught) {
      notify(errorMessage(caught), "error");
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const result = await syncClock();
      notify(
        result.corrected
          ? `Jam dikoreksi ${result.offsetSecs > 0 ? "+" : ""}${result.offsetSecs} detik`
          : "Jam sistem sudah akurat",
        "success",
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSyncing(false);
    }
  };

  const submitPassphrase = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (newPassphrase.length < 8) {
      setError("Passphrase baru minimal 8 karakter");
      return;
    }
    if (newPassphrase !== confirmPassphrase) {
      setError("Konfirmasi passphrase baru tidak sama");
      return;
    }

    try {
      await changePassphrase(oldPassphrase, newPassphrase);
      notify("Passphrase berhasil diganti", "success");
      setChangingPassphrase(false);
      setOldPassphrase("");
      setNewPassphrase("");
      setConfirmPassphrase("");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const handleCopyAll = async () => {
    try {
      const text = await api.exportText();
      const ok = await copyText(text);
      notify(
        ok ? "Semua URI disalin ke clipboard" : "Gagal menyalin",
        ok ? "success" : "error",
      );
    } catch (caught) {
      notify(errorMessage(caught), "error");
    }
  };

  const handleBackup = async () => {
    try {
      const path = await api.exportBackup();
      if (path) notify("File backup tersimpan", "success");
    } catch (caught) {
      notify(errorMessage(caught), "error");
    }
  };

  return (
    <Modal title="Pengaturan" onClose={onClose} wide>
      <div className="space-y-5">
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Tampilan
          </h3>

          <Field label="Tema">
            <select
              className="field"
              value={settings.theme}
              onChange={(event) => void updateSetting("theme", event.target.value as Theme)}
            >
              <option value="system">Ikuti sistem</option>
              <option value="light">Terang</option>
              <option value="dark">Gelap</option>
            </select>
          </Field>
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Keamanan
          </h3>

          <Field
            label="Kunci otomatis"
            hint={`setelah ${formatDuration(settings.autolock_secs)} diam`}
          >
            <select
              className="field"
              value={settings.autolock_secs}
              onChange={(event) =>
                void updateSetting("autolock_secs", Number(event.target.value))
              }
            >
              {AUTOLOCK_CHOICES.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {formatDuration(seconds)}
                </option>
              ))}
            </select>
          </Field>

          {!changingPassphrase ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setChangingPassphrase(true)}
            >
              <KeyIcon size={14} /> Ganti passphrase
            </button>
          ) : (
            <form
              onSubmit={submitPassphrase}
              className="space-y-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <Field label="Passphrase lama">
                <input
                  className="field"
                  type="password"
                  autoComplete="current-password"
                  value={oldPassphrase}
                  onChange={(event) => setOldPassphrase(event.target.value)}
                  autoFocus
                />
              </Field>
              <Field label="Passphrase baru" hint="min. 8 karakter">
                <input
                  className="field"
                  type="password"
                  autoComplete="new-password"
                  value={newPassphrase}
                  onChange={(event) => setNewPassphrase(event.target.value)}
                />
              </Field>
              <Field label="Ulangi passphrase baru">
                <input
                  className="field"
                  type="password"
                  autoComplete="new-password"
                  value={confirmPassphrase}
                  onChange={(event) => setConfirmPassphrase(event.target.value)}
                />
              </Field>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setChangingPassphrase(false);
                    setError(null);
                  }}
                >
                  Batal
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? "Mengenkripsi..." : "Ganti"}
                </button>
              </div>
            </form>
          )}
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Jam</h3>

          <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
            <div className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <ClockIcon size={14} />
              <span>
                Koreksi jam:{" "}
                <strong className="font-semibold text-zinc-900 dark:text-zinc-100">
                  {settings.offset_secs > 0 ? "+" : ""}
                  {settings.offset_secs}s
                </strong>
              </span>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleSync}
              disabled={syncing}
            >
              <RefreshIcon size={14} className={syncing ? "animate-spin" : ""} />
              {syncing ? "Menyinkronkan..." : "Sinkronkan"}
            </button>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Cadangan
          </h3>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost" onClick={handleCopyAll}>
              <CopyIcon size={14} /> Salin semua URI
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleBackup}
              disabled={busy}
            >
              <DownloadIcon size={14} /> Simpan file backup
            </button>
          </div>
          <p className="text-[13px] leading-relaxed text-zinc-400 dark:text-zinc-500">
            Backup berupa teks berisi secret setiap akun dalam bentuk{" "}
            <span className="font-mono">otpauth://</span>. Simpan di tempat aman.
          </p>
        </section>

        {error ? (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
            <AlertIcon size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
