import { useState } from "react";
import type { FormEvent } from "react";

import { errorMessage } from "../../api/tauri";
import { Field } from "../../components/ui/Modal";
import { KeyIcon, ShieldIcon } from "../../components/ui/icons";
import { useToast } from "../../components/ui/Toast";
import { useVault } from "./VaultProvider";

/** First run: create the encrypted vault. */
export function SetupScreen() {
  const { createVault, busy } = useVault();
  const notify = useToast();

  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (passphrase.length < 8) {
      setError("Passphrase minimal 8 karakter");
      return;
    }
    if (passphrase !== confirm) {
      setError("Konfirmasi passphrase tidak sama");
      return;
    }

    try {
      await createVault(passphrase);
      notify("Vault berhasil dibuat", "success");
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white">
            <ShieldIcon size={22} />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Buat vault baru</h1>
          <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
            Semua kode 2FA disimpan terenkripsi dengan passphrase ini.{" "}
            <strong className="font-medium text-zinc-700 dark:text-zinc-300">
              Tidak ada cara memulihkannya
            </strong>{" "}
            jika Anda lupa.
          </p>
        </div>

        <Field label="Passphrase" hint="min. 8 karakter">
          <input
            className="field"
            type="password"
            autoComplete="new-password"
            value={passphrase}
            onChange={(event) => setPassphrase(event.target.value)}
            placeholder="••••••••"
            autoFocus
          />
        </Field>

        <Field label="Ulangi passphrase" error={error ?? undefined}>
          <input
            className="field"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder="••••••••"
          />
        </Field>

        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy ? (
            "Mengenkripsi..."
          ) : (
            <>
              <KeyIcon size={15} /> Buat vault
            </>
          )}
        </button>
      </form>
    </div>
  );
}
