/** Presentation helpers (pure functions, unit tested). */

/** Group a code for readability: `123 456` / `1234 5678`. */
export function formatCode(code: string): string {
  const digits = code.replace(/\D/g, "");
  if (digits.length === 0) return code;
  if (digits.length % 2 !== 0) return digits;

  const half = digits.length / 2;
  return `${digits.slice(0, half)} ${digits.slice(half)}`;
}

/** `23` → `23s`, empty string when there is no countdown (HOTP). */
export function formatRemaining(seconds: number): string {
  if (seconds <= 0) return "";
  return `${seconds}s`;
}

/** Human readable duration for the auto lock setting. */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "Nonaktif";
  if (seconds % 3600 === 0) return `${seconds / 3600} jam`;
  if (seconds % 60 === 0) return `${seconds / 60} menit`;
  return `${seconds} detik`;
}

/** Case insensitive search across issuer, account and algorithm. */
export function matchesQuery(
  entry: { issuer: string; account: string; algorithm: string; kind: string },
  query: string,
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [entry.issuer, entry.account, entry.algorithm, entry.kind].some((field) =>
    field.toLowerCase().includes(needle),
  );
}

/** Short label used by the colour-coded avatar. */
export function initials(issuer: string, account: string): string {
  const source = issuer.trim() || account.trim() || "?";
  const words = source.split(/[\s@._-]+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return `${words[0]![0]!}${words[1]![0]!}`.toUpperCase();
}

/** Stable 0..359 hue so the same service always gets the same colour. */
export function hueFor(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

/** Progress within the current TOTP window, 0 (fresh) → 1 (about to flip). */
export function windowProgress(remaining: number, period: number): number {
  if (period <= 0) return 0;
  const left = Math.max(0, Math.min(remaining, period));
  return 1 - left / period;
}

/**
 * Advance a snapshot countdown locally: `remaining` was computed on the
 * backend `elapsedSecs` ago, so subtract the time that passed since then.
 * Wraps at 0 into the next window (backend `remaining` is always ≥ 1, so a
 * local result of 0 means "just flipped" and lands on a full period).
 */
export function tickRemaining(remaining: number, period: number, elapsedSecs: number): number {
  if (period <= 0) return remaining;
  const spent = Math.max(0, Math.floor(elapsedSecs));
  const left = remaining - spent;
  const wrapped = ((((left - 1) % period) + period) % period) + 1;
  return wrapped;
}

/** Default input payload for the entry form. */
export function emptyEntryInput() {
  return {
    issuer: "",
    account: "",
    secret: "",
    kind: "totp" as const,
    algorithm: "SHA1" as const,
    digits: 6,
    period: 30,
    counter: 0,
  };
}
