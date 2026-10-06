import { useState } from "react";
import type { FormEvent } from "react";

import { errorMessage } from "../../api/tauri";
import { Field } from "../../components/ui/Modal";
import { LockIcon, UnlockIcon } from "../../components/ui/icons";
import { useVault } from "./VaultProvider";

/** Locked state: only the passphrase unlocks the decrypted entries. */
export function UnlockScreen() {
  const { unlock, busy, error, clearError } = useVault();

  const [passphrase, setPassphrase] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    clearError();

    if (!passphrase) {
      setLocalError("Masukkan passphrase");
      return;
    }

    try {
      await unlock(passphrase);
      setPassphrase("");
    } catch (caught) {
      setLocalError(errorMessage(caught));
      setPassphrase("");
    }
  };

  const message = localError ?? error;

  return (
    <div className="flex h-full items-center justify-center p-6">
      <form
        onSubmit={submit}
        className="w-full max-w-sm space-y-5 rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900"
      >
        <div className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-600 text-white">
            <LockIcon size={22} />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Vault terkunci</h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Masukkan passphrase untuk membuka kode 2FA Anda.
          </p>
        </div>

        <Field label="Passphrase" error={message ?? undefined}>
          <input
            className="field"
            type="password"
            autoComplete="current-password"
            value={passphrase}
            onChange={(event) => {
              setPassphrase(event.target.value);
              setLocalError(null);
              clearError();
            }}
            placeholder="••••••••"
            autoFocus
          />
        </Field>

        <button type="submit" className="btn btn-primary w-full" disabled={busy}>
          {busy ? (
            "Membuka..."
          ) : (
            <>
              <UnlockIcon size={15} /> Buka vault
            </>
          )}
        </button>
      </form>
    </div>
  );
}
