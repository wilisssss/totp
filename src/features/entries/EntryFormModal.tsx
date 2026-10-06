import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { api, errorMessage } from "../../api/tauri";
import type { Algorithm, EntryInput, EntryView, OtpKind } from "../../api/types";
import { Field, Modal } from "../../components/ui/Modal";
import { AlertIcon } from "../../components/ui/icons";
import { useToast } from "../../components/ui/Toast";
import { useVault } from "../vault/VaultProvider";

interface EntryFormModalProps {
  /** `null` creates a new entry, otherwise the entry being edited. */
  entry: EntryView | null;
  onClose: () => void;
}

const DIGIT_CHOICES = [5, 6, 7, 8];

function initialForm(entry: EntryView | null): EntryInput {
  return {
    issuer: entry?.issuer ?? "",
    account: entry?.account ?? "",
    secret: "",
    kind: entry?.kind ?? "totp",
    algorithm: entry?.algorithm ?? "SHA1",
    digits: entry?.digits ?? 6,
    period: entry?.period ?? 30,
    counter: entry?.counter ?? 0,
  };
}

export function EntryFormModal({ entry, onClose }: EntryFormModalProps) {
  const notify = useToast();
  const { refresh, busy } = useVault();

  const [form, setForm] = useState<EntryInput>(() => initialForm(entry));
  const [error, setError] = useState<string | null>(null);
  const [loadingSecret, setLoadingSecret] = useState(entry !== null);

  const isEdit = entry !== null;

  // The secret is never part of the snapshot, so fetch it on demand.
  useEffect(() => {
    if (!entry) return;
    let cancelled = false;

    void (async () => {
      try {
        const secret = await api.revealSecret(entry.id);
        if (!cancelled) {
          setForm((current) => ({ ...current, secret }));
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) setError(errorMessage(caught));
      } finally {
        if (!cancelled) setLoadingSecret(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [entry]);

  const update = <K extends keyof EntryInput>(key: K, value: EntryInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    if (!form.issuer.trim() && !form.account.trim()) {
      setError("Isi nama layanan atau akun");
      return;
    }
    if (!form.secret.trim()) {
      setError("Secret Base32 wajib diisi");
      return;
    }

    try {
      if (entry) {
        await api.updateEntry(entry.id, form);
        notify("Entri diperbarui", "success");
      } else {
        await api.createEntry(form);
        notify("Entri ditambahkan", "success");
      }
      await refresh();
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <Modal
      title={isEdit ? "Ubah akun" : "Tambah akun"}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Batal
          </button>
          <button
            type="submit"
            form="entry-form"
            className="btn btn-primary"
            disabled={busy || loadingSecret}
          >
            {busy ? "Menyimpan..." : "Simpan"}
          </button>
        </>
      }
    >
      <form id="entry-form" onSubmit={submit} className="space-y-4">
        {error ? (
          <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300">
            <AlertIcon size={14} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-3 min-[400px]:grid-cols-2">
          <Field label="Layanan" hint="opsional">
            <input
              className="field"
              value={form.issuer}
              onChange={(event) => update("issuer", event.target.value)}
              placeholder="GitHub"
              maxLength={128}
              autoFocus={!isEdit}
            />
          </Field>

          <Field label="Akun">
            <input
              className="field"
              value={form.account}
              onChange={(event) => update("account", event.target.value)}
              placeholder="nama@contoh.com"
              maxLength={128}
              autoFocus={isEdit}
            />
          </Field>
        </div>

        <Field label="Secret (Base32)" hint={loadingSecret ? "memuat..." : undefined}>
          <textarea
            className="field font-mono text-xs"
            rows={2}
            value={form.secret}
            onChange={(event) => update("secret", event.target.value)}
            placeholder="JBSWY3DPEHPK3PXP"
            spellCheck={false}
            disabled={loadingSecret}
          />
        </Field>

        <section className="space-y-3 rounded-xl border border-zinc-200 p-3.5 dark:border-zinc-800">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Parameter OTP
          </h3>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Tipe">
              <div className="flex h-10 overflow-hidden rounded-xl border border-zinc-300 dark:border-zinc-700">
                {(["totp", "hotp"] as OtpKind[]).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => update("kind", kind)}
                    className={`flex-1 px-3 text-xs font-semibold uppercase tracking-wide transition-colors ${
                      form.kind === kind
                        ? "bg-indigo-600 text-white"
                        : "bg-transparent text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    }`}
                  >
                    {kind}
                  </button>
                ))}
              </div>
            </Field>

            <Field label="Algoritma">
              <select
                className="field"
                value={form.algorithm}
                onChange={(event) => update("algorithm", event.target.value as Algorithm)}
              >
                <option value="SHA1">SHA1</option>
                <option value="SHA256">SHA256</option>
                <option value="SHA512">SHA512</option>
              </select>
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Digit">
              <select
                className="field"
                value={form.digits}
                onChange={(event) => update("digits", Number(event.target.value))}
              >
                {DIGIT_CHOICES.map((digits) => (
                  <option key={digits} value={digits}>
                    {digits}
                  </option>
                ))}
              </select>
            </Field>

            {form.kind === "totp" ? (
              <Field label="Periode" hint="detik">
                <input
                  className="field"
                  type="number"
                  min={1}
                  max={300}
                  value={form.period}
                  onChange={(event) => update("period", Number(event.target.value))}
                />
              </Field>
            ) : (
              <Field label="Counter">
                <input
                  className="field"
                  type="number"
                  min={0}
                  value={form.counter}
                  onChange={(event) => update("counter", Number(event.target.value))}
                />
              </Field>
            )}
          </div>
        </section>

        {/* Submit target lives outside the modal footer. */}
        <button type="submit" className="sr-only">
          Simpan
        </button>
      </form>
    </Modal>
  );
}
