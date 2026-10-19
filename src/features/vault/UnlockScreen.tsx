import { useState } from "react";
import type { FormEvent } from "react";

import { CommandError, errorMessage } from "../../api/tauri";
import { Field } from "../../components/ui/Modal";
import { FingerprintIcon, LockIcon, UnlockIcon } from "../../components/ui/icons";
import { AuthCard } from "./AuthCard";
import { useVault } from "./VaultProvider";

/** Swallow the "user closed the prompt" case — that is not an error. */
function isBiometricCancel(error: unknown): boolean {
  return error instanceof CommandError && error.code === "biometric_cancelled";
}

/** Locked state: passphrase, or the Android fingerprint when enrolled. */
export function UnlockScreen() {
  const { unlock, busy, error, clearError, biometric, biometricBusy, unlockWithBiometric } =
    useVault();

  const [passphrase, setPassphrase] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [bioError, setBioError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError(null);
    setBioError(null);
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

  const handleBiometric = async () => {
    setLocalError(null);
    setBioError(null);
    clearError();

    try {
      await unlockWithBiometric();
    } catch (caught) {
      if (!isBiometricCancel(caught)) {
        setBioError(errorMessage(caught));
      }
    }
  };

  const message = localError ?? bioError ?? error;
  const fingerprintReady = biometric.available && biometric.enrolled;

  return (
    <AuthCard
      title="Vault terkunci"
      icon={<LockIcon size={22} />}
      description="Masukkan passphrase untuk membuka kode 2FA Anda."
    >
      <div className="space-y-4">
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

        {fingerprintReady ? (
          <>
            <div className="flex items-center gap-3 text-xs text-zinc-400 dark:text-zinc-500">
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
              atau
              <span className="h-px flex-1 bg-zinc-200 dark:bg-zinc-800" />
            </div>
            <button
              type="button"
              className="btn btn-ghost w-full"
              onClick={() => void handleBiometric()}
              disabled={busy || biometricBusy}
            >
              {biometricBusy ? (
                "Menunggu sidik jari..."
              ) : (
                <>
                  <FingerprintIcon size={15} /> Buka dengan sidik jari
                </>
              )}
            </button>
          </>
        ) : null}
      </div>
    </AuthCard>
  );
}
