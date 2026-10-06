import { useState } from "react";
import type { FormEvent } from "react";

import { errorMessage } from "../../api/tauri";
import { Field } from "../../components/ui/Modal";
import { LockIcon, UnlockIcon } from "../../components/ui/icons";
import { AuthCard } from "./AuthCard";
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
    <AuthCard
      title="Vault terkunci"
      icon={<LockIcon size={22} />}
      description="Masukkan passphrase untuk membuka kode 2FA Anda."
    >
      <form onSubmit={submit} className="space-y-5">
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
    </AuthCard>
  );
}
