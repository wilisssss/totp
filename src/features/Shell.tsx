import { MainScreen } from "./main/MainScreen";
import { SetupScreen } from "./vault/SetupScreen";
import { UnlockScreen } from "./vault/UnlockScreen";
import { useVault } from "./vault/VaultProvider";

/** Routes between the four top level states of the vault. */
export function Shell() {
  const { phase } = useVault();

  if (phase === "ready") return <MainScreen />;

  if (phase === "loading") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-zinc-300 border-t-indigo-600" />
      </div>
    );
  }

  return phase === "setup" ? <SetupScreen /> : <UnlockScreen />;
}
