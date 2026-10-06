import { invoke as tauriInvoke } from "@tauri-apps/api/core";

import type {
  ClockSync,
  CommandErrorPayload,
  EntryInput,
  EntryView,
  ImportReport,
  Settings,
  Snapshot,
  VaultStatus,
} from "./types";

/** Error with the machine readable `code` produced by the Rust backend. */
export class CommandError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CommandError";
    this.code = code;
  }
}

function normalise(error: unknown): CommandError {
  if (error && typeof error === "object" && "message" in error) {
    const payload = error as CommandErrorPayload;
    return new CommandError(payload.code ?? "unknown", payload.message);
  }
  if (typeof error === "string") {
    return new CommandError("unknown", error);
  }
  return new CommandError("unknown", "Terjadi kesalahan yang tidak diketahui");
}

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(cmd, args);
  } catch (error) {
    throw normalise(error);
  }
}

/** Extract a human readable message from anything thrown in the UI. */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Terjadi kesalahan yang tidak diketahui";
}

export const api = {
  // vault ---------------------------------------------------------------
  status: () => call<VaultStatus>("vault_status"),
  createVault: (passphrase: string) => call<Snapshot>("vault_create", { passphrase }),
  unlock: (passphrase: string) => call<Snapshot>("vault_unlock", { passphrase }),
  lock: () => call<VaultStatus>("vault_lock"),
  changePassphrase: (oldPassphrase: string, newPassphrase: string) =>
    call<Snapshot>("vault_change_passphrase", {
      oldPassphrase,
      newPassphrase,
    }),

  // entries -------------------------------------------------------------
  snapshot: () => call<Snapshot>("snapshot"),
  createEntry: (input: EntryInput) => call<EntryView>("entry_create", { input }),
  updateEntry: (id: string, input: EntryInput) =>
    call<EntryView>("entry_update", { id, input }),
  deleteEntry: (id: string) => call<void>("entry_delete", { id }),
  reorderEntries: (ids: string[]) => call<void>("entry_reorder", { ids }),
  togglePin: (id: string) => call<EntryView>("entry_toggle_pin", { id }),
  hotpNext: (id: string) => call<EntryView>("entry_hotp_next", { id }),
  revealSecret: (id: string) => call<string>("entry_reveal_secret", { id }),
  entryQr: (id: string) => call<string>("entry_qr", { id }),

  // import / export -----------------------------------------------------
  importText: (text: string) => call<ImportReport>("import_text", { text }),
  importQrFromPath: (path: string) => call<ImportReport>("import_qr_from_path", { path }),
  importQrBytes: (bytes: Uint8Array) =>
    call<ImportReport>("import_qr_bytes", { bytes: Array.from(bytes) }),
  exportText: () => call<string>("export_text"),
  exportBackup: () => call<string | null>("export_backup"),

  // settings ------------------------------------------------------------
  getSettings: () => call<Settings>("settings_get"),
  setSettings: (settings: Settings) => call<Settings>("settings_set", { settings }),
  syncClock: () => call<ClockSync>("clock_sync"),
};
