import { useState } from "react";
import type { FormEvent } from "react";

import { errorMessage } from "../../api/tauri";
import { Field } from "../../components/ui/Modal";
import { KeyIcon, ShieldIcon } from "../../components/ui/icons";
import { useToast } from "../../components/ui/Toast";
import { AuthCard } from "./AuthCard";
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

    // Keep in sync with MIN_PASSPHRASE_LEN in src-tauri/src/commands/vault.rs.
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
    <AuthCard
      title="Buat vault baru"
      icon={<ShieldIcon size={22} />}
      description={
        <>
          Semua kode 2FA disimpan terenkripsi dengan passphrase ini.{" "}
          <strong className="font-medium text-zinc-700 dark:text-zinc-300">
            Tidak ada cara memulihkannya
          </strong>{" "}
          jika Anda lupa.
        </>
      }
    >
      <form onSubmit={submit} className="space-y-5">
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
    </AuthCard>
  );
}
