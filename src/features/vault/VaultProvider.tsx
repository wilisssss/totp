import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";

import { api, errorMessage } from "../../api/tauri";
import type { Settings, Snapshot, Theme } from "../../api/types";

export type Phase = "loading" | "setup" | "locked" | "ready";

/**
 * Local clock for the TOTP cards: the wall clock time (`now`) and the moment
 * the current snapshot was fetched (`snapshotAt`). Cards derive the countdown
 * from these instead of re-fetching the whole snapshot every second.
 */
export interface TickState {
  now: number;
  snapshotAt: number;
}

const NO_TICK: TickState = { now: 0, snapshotAt: 0 };

const TickContext = createContext<TickState>(NO_TICK);

/** Ticks once a second while the vault is unlocked (no IPC involved). */
export function useTick(): TickState {
  return useContext(TickContext);
}

/** Refresh the snapshot at least this often even when nothing rotates. */
const SAFETY_REFRESH_SECS = 15;

interface VaultContextValue {
  phase: Phase;
  snapshot: Snapshot | null;
  settings: Settings | null;
  /** True while an Argon2 or disk operation is running. */
  busy: boolean;
  /** Fatal error from startup (backend unreachable, corrupt vault, ...). */
  error: string | null;
  clearError: () => void;
  refresh: () => Promise<void>;
  createVault: (passphrase: string) => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
  lock: () => Promise<void>;
  changePassphrase: (oldPassphrase: string, newPassphrase: string) => Promise<void>;
  saveSettings: (settings: Settings) => Promise<void>;
  syncClock: () => Promise<{ offsetSecs: number; corrected: boolean }>;
}

const VaultContext = createContext<VaultContextValue | null>(null);

export function useVault(): VaultContextValue {
  const value = useContext(VaultContext);
  if (!value) {
    throw new Error("useVault harus dipakai di dalam VaultProvider");
  }
  return value;
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") {
    root.classList.toggle("dark", window.matchMedia("(prefers-color-scheme: dark)").matches);
  } else {
    root.classList.toggle("dark", theme === "dark");
  }
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState<TickState>(NO_TICK);

  // Latest snapshot + when it was adopted, readable from the ticker without
  // re-subscribing the interval on every snapshot change.
  const snapshotRef = useRef<Snapshot | null>(null);
  const snapshotAtRef = useRef(0);

  const adoptSnapshot = useCallback((next: Snapshot) => {
    snapshotRef.current = next;
    snapshotAtRef.current = Date.now();
    setSnapshot(next);
    setPhase(next.locked ? "locked" : "ready");
  }, []);

  const refresh = useCallback(async () => {
    try {
      adoptSnapshot(await api.snapshot());
    } catch (caught) {
      // The backend is going away (app closing) — keep the current view.
      console.error("snapshot gagal", caught);
    }
  }, [adoptSnapshot]);

  // Bootstrap: settings first (theme applies even while locked), then status.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const current = await api.getSettings();
        if (cancelled) return;
        setSettings(current);
        applyTheme(current.theme);

        const status = await api.status();
        if (cancelled) return;

        if (!status.exists) {
          setPhase("setup");
        } else if (status.locked) {
          setPhase("locked");
        } else {
          setPhase("ready");
          adoptSnapshot(await api.snapshot());
        }
      } catch (caught) {
        if (!cancelled) {
          setError(errorMessage(caught));
          setPhase("setup");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [adoptSnapshot]);

  // Keep the countdown moving locally: tick once a second (pure client side),
  // and only hit the backend when a code actually rotates — or every
  // SAFETY_REFRESH_SECS as a drift guard. This replaces the previous
  // once-a-second full snapshot poll that re-serialised every entry over IPC.
  useEffect(() => {
    if (phase !== "ready") return;
    setTick({ now: Date.now(), snapshotAt: snapshotAtRef.current });

    let inFlight = false;
    // If the backend keeps failing, retry at most every few seconds instead
    // of hammering it on every tick.
    const RETRY_BACKOFF_MS = 3000;
    let lastAttempt = 0;

    const timer = window.setInterval(() => {
      const now = Date.now();
      setTick({ now, snapshotAt: snapshotAtRef.current });

      const snap = snapshotRef.current;
      const at = snapshotAtRef.current;
      if (!snap || at <= 0) return;

      const elapsed = (now - at) / 1000;
      const rotated = snap.entries.some(
        (entry) => entry.kind === "totp" && elapsed >= entry.remaining,
      );
      if (
        (rotated || elapsed >= SAFETY_REFRESH_SECS) &&
        !inFlight &&
        now - lastAttempt >= RETRY_BACKOFF_MS
      ) {
        lastAttempt = now;
        inFlight = true;
        void refresh().finally(() => {
          inFlight = false;
        });
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, refresh]);

  // Follow the OS theme when the setting is "system".
  useEffect(() => {
    if (settings?.theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [settings?.theme]);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    setBusy(true);
    try {
      return await action();
    } finally {
      setBusy(false);
    }
  }, []);

  const createVault = useCallback(
    async (passphrase: string) => {
      adoptSnapshot(await run(() => api.createVault(passphrase)));
    },
    [adoptSnapshot, run],
  );

  const unlock = useCallback(
    async (passphrase: string) => {
      adoptSnapshot(await run(() => api.unlock(passphrase)));
    },
    [adoptSnapshot, run],
  );

  const lock = useCallback(async () => {
    await run(() => api.lock());
    setSnapshot(null);
    setPhase("locked");
  }, [run]);

  const changePassphrase = useCallback(
    async (oldPassphrase: string, newPassphrase: string) => {
      adoptSnapshot(await run(() => api.changePassphrase(oldPassphrase, newPassphrase)));
    },
    [adoptSnapshot, run],
  );

  const saveSettings = useCallback(
    async (next: Settings) => {
      const saved = await run(() => api.setSettings(next));
      setSettings(saved);
      applyTheme(saved.theme);
    },
    [run],
  );

  const syncClock = useCallback(async () => {
    const result = await run(() => api.syncClock());
    setSettings((current) =>
      current ? { ...current, offset_secs: result.offset_secs } : current,
    );
    // The offset changes every derived code — fetch a fresh snapshot now
    // instead of waiting for the next safety refresh.
    await refresh();
    return {
      offsetSecs: result.offset_secs,
      corrected: result.corrected,
    };
  }, [run, refresh]);

  const value = useMemo<VaultContextValue>(
    () => ({
      phase,
      snapshot,
      settings,
      busy,
      error,
      clearError: () => setError(null),
      refresh,
      createVault,
      unlock,
      lock,
      changePassphrase,
      saveSettings,
      syncClock,
    }),
    [
      phase,
      snapshot,
      settings,
      busy,
      error,
      refresh,
      createVault,
      unlock,
      lock,
      changePassphrase,
      saveSettings,
      syncClock,
    ],
  );

  return (
    <VaultContext.Provider value={value}>
      <TickContext.Provider value={tick}>{children}</TickContext.Provider>
    </VaultContext.Provider>
  );
}
