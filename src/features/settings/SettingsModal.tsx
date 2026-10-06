import { useState } from "react";
import type { FormEvent, ReactNode } from "react";

import { api, errorMessage } from "../../api/tauri";
import type { Settings, Theme } from "../../api/types";
import { copyText } from "../../lib/clipboard";
import { formatDuration } from "../../lib/format";
import { Field, Modal } from "../../components/ui/Modal";
import { FormError } from "../../components/ui/FormError";
import {
  ClockIcon,
  CopyIcon,
  DownloadIcon,
  EyeIcon,
  KeyIcon,
  RefreshIcon,
  RestoreIcon,
  TrayIcon,
} from "../../components/ui/icons";
import { useToast } from "../../components/ui/Toast";
import { useVault } from "../vault/VaultProvider";

const AUTOLOCK_CHOICES = [0, 60, 300, 900, 3600];

export function SettingsModal({ onClose }: { onClose: () => void }) {
  const { settings, saveSettings, syncClock, changePassphrase, refresh, busy } = useVault();
  const notify = useToast();

  const [changingPassphrase, setChangingPassphrase] = useState(false);
  const [oldPassphrase, setOldPassphrase] = useState("");
  const [newPassphrase, setNewPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  // Encrypted backup form: "export" or "import", hidden when "none".
  const [encMode, setEncMode] = useState<"none" | "export" | "import">("none");
  const [encPassphrase, setEncPassphrase] = useState("");
  const [encConfirm, setEncConfirm] = useState("");

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

    // Keep in sync with MIN_PASSPHRASE_LEN in src-tauri/src/commands/vault.rs.
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

  const showEncryptedForm = (mode: "export" | "import") => {
    setEncMode(mode);
    setEncPassphrase("");
    setEncConfirm("");
    setError(null);
  };

  const resetEncryptedForm = () => {
    setEncMode("none");
    setEncPassphrase("");
    setEncConfirm("");
    setError(null);
  };

  const handleEncryptedBackup = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    // Keep in sync with MIN_PASSPHRASE_LEN in src-tauri/src/commands/vault.rs.
    if (encPassphrase.length < 8) {
      setError("Passphrase minimal 8 karakter");
      return;
    }
    if (encMode === "export" && encPassphrase !== encConfirm) {
      setError("Konfirmasi passphrase tidak sama");
      return;
    }

    try {
      if (encMode === "export") {
        const path = await api.exportEncryptedBackup(encPassphrase);
        resetEncryptedForm();
        if (path) notify("Backup terenkripsi tersimpan", "success");
      } else {
        const report = await api.importEncryptedBackup(encPassphrase);
        resetEncryptedForm();
        if (report) {
          await refresh();
          notify(`${report.imported} entri dipulihkan`, "success");
        }
      }
    } catch (caught) {
      setError(errorMessage(caught));
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

          <SettingToggle
            icon={<EyeIcon size={14} />}
            label="Sembunyikan kode"
            hint="Kode diburamkan sampai kartunya diklik"
            checked={settings.hide_codes}
            onChange={(value) => void updateSetting("hide_codes", value)}
          />
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

          <SettingToggle
            icon={<TrayIcon size={14} />}
            label="Tutup ke system tray"
            hint="Tombol tutup menyembunyikan jendela, tidak keluar"
            checked={settings.close_to_tray}
            onChange={(value) => void updateSetting("close_to_tray", value)}
          />

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

          {encMode === "none" ? (
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
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => showEncryptedForm("export")}
              >
                <DownloadIcon size={14} /> Backup terenkripsi
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => showEncryptedForm("import")}
              >
                <RestoreIcon size={14} /> Pulihkan backup
              </button>
            </div>
          ) : (
            <form
              onSubmit={handleEncryptedBackup}
              className="space-y-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"
            >
              <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                {encMode === "export"
                  ? "Semua entri akan disegel dengan passphrase ini (Argon2id + AES-256-GCM, format sama dengan vault). Lupa passphrase = backup tak terbaca."
                  : "Masukkan passphrase backup, lalu pilih filenya. Entri digabungkan; yang sudah ada dilewati."}
              </p>

              <Field label="Passphrase backup" hint="min. 8 karakter">
                <input
                  className="field"
                  type="password"
                  value={encPassphrase}
                  onChange={(event) => setEncPassphrase(event.target.value)}
                  autoFocus
                />
              </Field>

              {encMode === "export" ? (
                <Field label="Ulangi passphrase">
                  <input
                    className="field"
                    type="password"
                    value={encConfirm}
                    onChange={(event) => setEncConfirm(event.target.value)}
                  />
                </Field>
              ) : null}

              <div className="flex justify-end gap-2">
                <button type="button" className="btn btn-ghost" onClick={resetEncryptedForm}>
                  Batal
                </button>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy
                    ? "Memproses..."
                    : encMode === "export"
                      ? "Simpan backup"
                      : "Pilih file & pulihkan"}
                </button>
              </div>
            </form>
          )}

          <p className="text-[13px] leading-relaxed text-zinc-400 dark:text-zinc-500">
            Backup berupa teks berisi secret setiap akun dalam bentuk{" "}
            <span className="font-mono">otpauth://</span>. Simpan di tempat aman.
          </p>
        </section>

        {error ? <FormError message={error} /> : null}
      </div>
    </Modal>
  );
}

interface SettingToggleProps {
  icon: ReactNode;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

function SettingToggle({ icon, label, hint, checked, onChange }: SettingToggleProps) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-zinc-200 px-3 py-2.5 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700">
      <span className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
        {icon}
        <span>
          {label}
          <span className="block text-[13px] text-zinc-400 dark:text-zinc-500">{hint}</span>
        </span>
      </span>
      <input
        type="checkbox"
        className="h-4 w-4 shrink-0 accent-indigo-600"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
