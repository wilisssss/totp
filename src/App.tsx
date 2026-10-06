import { ToastProvider } from "./components/ui/Toast";
import { Shell } from "./features/Shell";
import { VaultProvider } from "./features/vault/VaultProvider";

/**
 * TOTP desktop authenticator.
 *
 * The UI only ever sees derived codes; secrets stay in the encrypted Rust
 * backend unless the user explicitly reveals them.
 */
export default function App() {
  return (
    <ToastProvider>
      <VaultProvider>
        <Shell />
      </VaultProvider>
    </ToastProvider>
  );
}
