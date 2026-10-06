/** Types mirroring the Rust command DTOs. */

export type OtpKind = "totp" | "hotp";

/** Serialised as `SHA1` / `SHA256` / `SHA512`. */
export type Algorithm = "SHA1" | "SHA256" | "SHA512";

export type Theme = "system" | "light" | "dark";

/** Secret-free projection of an entry; `code` is derived on demand. */
export interface EntryView {
  id: string;
  issuer: string;
  account: string;
  kind: OtpKind;
  algorithm: Algorithm;
  digits: number;
  period: number;
  counter: number;
  pinned: boolean;
  code: string;
  remaining: number;
  /** Preview of the next code (next window / counter + 1). */
  next_code: string;
  /** Unix seconds when the entry was added (client-side sorting). */
  created_at: number;
}

export interface Snapshot {
  locked: boolean;
  entries: EntryView[];
  offset_secs: number;
  autolock_secs: number;
}

export interface VaultStatus {
  exists: boolean;
  locked: boolean;
}

export interface EntryInput {
  issuer: string;
  account: string;
  secret: string;
  kind: OtpKind;
  algorithm: Algorithm;
  digits: number;
  period: number;
  counter: number;
}

export interface Settings {
  theme: Theme;
  autolock_secs: number;
  offset_secs: number;
  /** Blur codes until the card is clicked (privacy mode). */
  hide_codes: boolean;
  /** Close button hides to the tray instead of quitting. */
  close_to_tray: boolean;
}

export interface ImportIssue {
  value: string;
  reason: string;
}

export interface ImportReport {
  imported: number;
  skipped: number;
  failed: number;
  issues: ImportIssue[];
}

export interface ClockSync {
  offset_secs: number;
  corrected: boolean;
}

/** Normalised `{ code, message }` error payload coming from Rust. */
export interface CommandErrorPayload {
  code: string;
  message: string;
}
