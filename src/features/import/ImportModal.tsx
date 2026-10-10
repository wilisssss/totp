import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { readImage, readText } from "@tauri-apps/plugin-clipboard-manager";

import { api, errorMessage } from "../../api/tauri";
import type { ImportReport } from "../../api/types";
import { Modal } from "../../components/ui/Modal";
import { FormError } from "../../components/ui/FormError";
import { ClipboardIcon, UploadIcon } from "../../components/ui/icons";
import { useToast } from "../../components/ui/Toast";
import { useVault } from "../vault/VaultProvider";

/** Chunked base64 — `String.fromCharCode(...bytes)` would blow the stack. */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

/** Paste URIs, or drop/paste/pick a QR code image. */
export function ImportModal({ onClose }: { onClose: () => void }) {
  const notify = useToast();
  const { refresh } = useVault();

  const [text, setText] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [working, setWorking] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const runImport = useCallback(
    async (action: () => Promise<ImportReport>) => {
      setWorking(true);
      setError(null);
      try {
        const result = await action();
        setReport(result);
        await refresh();
        if (result.imported > 0) {
          notify(`${result.imported} entri diimpor`, "success");
        }
        if (result.failed > 0 || result.skipped > 0) {
          notify(`${result.failed} gagal, ${result.skipped} dilewati (duplikat)`, "error");
        }
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setWorking(false);
      }
    },
    [notify, refresh],
  );

  const importText = useCallback(() => {
    if (!text.trim()) {
      setError("Tempel URI otpauth:// di kotak teks");
      return;
    }
    void runImport(() => api.importText(text));
  }, [runImport, text]);

  const importPath = useCallback(
    (path: string) => {
      void runImport(() => api.importQrFromPath(path));
    },
    [runImport],
  );

  const importFile = useCallback(
    (file: File) => {
      void (async () => {
        // Base64 keeps large images cheap over the IPC bridge (a JSON number
        // array would be ~5× larger than the file itself).
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error("Gagal membaca file gambar"));
          reader.readAsDataURL(file);
        });
        const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
        await runImport(() => api.importQrBytes(base64));
      })();
    },
    [runImport],
  );

  const importPathRef = useRef(importPath);
  importPathRef.current = importPath;
  const importFileRef = useRef(importFile);
  importFileRef.current = importFile;

  // Screenshots live on the system clipboard as raw pixels — WebKitGTK does
  // not expose them as DOM paste files, so read them through the clipboard
  // plugin: image first (a QR screenshot), otherwise otpauth:// text.
  const detectClipboard = useCallback(async () => {
    try {
      const image = await readImage();
      try {
        const { width, height } = await image.size();
        if (width > 0 && height > 0) {
          const rgba = await image.rgba();
          await runImport(() => api.importQrRgba(bytesToBase64(rgba), width, height));
          return;
        }
      } finally {
        void image.close().catch(() => {});
      }
    } catch {
      // No image on the clipboard — fall through to text.
    }

    try {
      const text = (await readText()).trim();
      if (/^otpauth(-migration)?:\/\//im.test(text)) {
        setText(text);
        await runImport(() => api.importText(text));
      }
    } catch {
      // Clipboard empty or unreadable — nothing to import.
    }
  }, [runImport]);

  const detectClipboardRef = useRef(detectClipboard);
  detectClipboardRef.current = detectClipboard;

  // Auto-detect once when the modal opens: if the clipboard already holds a
  // valid QR (screenshot) or URI, import it right away.
  useEffect(() => {
    void detectClipboardRef.current();
  }, []);

  // Native file drag & drop (the WebView swallows the DOM drop event).
  useEffect(() => {
    let dispose: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      try {
        const listener = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload as { type?: string; paths?: string[] };
          if (payload.type === "enter") setDragging(true);
          else if (payload.type === "leave") setDragging(false);
          else if (payload.type === "drop") {
            setDragging(false);
            const path = payload.paths?.[0];
            if (path) importPathRef.current(path);
          }
        });

        if (cancelled) listener();
        else dispose = listener;
      } catch (caught) {
        console.warn("drag & drop native tidak tersedia", caught);
      }
    })();

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  // Ctrl+V with an image in the clipboard imports it directly.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = event.clipboardData?.files?.[0];
      if (file) {
        event.preventDefault();
        importFileRef.current(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  return (
    <Modal
      title="Impor akun"
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {report ? "Selesai" : "Batal"}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={importText}
            disabled={working}
          >
            {working ? "Mengimpor..." : "Impor URI"}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
            URI otpauth:// (satu per baris)
          </label>
          <textarea
            className="field font-mono text-xs"
            rows={4}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder={
              "otpauth://totp/GitHub:nama@contoh.com?secret=JBSW...\notpauth-migration://offline?data=... (Google Authenticator)"
            }
            spellCheck={false}
            data-selectable
          />
        </div>

        <button
          type="button"
          onClick={() => void detectClipboard()}
          disabled={working}
          className="btn btn-ghost w-full"
          title="Baca screenshot QR atau URI otpauth:// dari clipboard"
        >
          <ClipboardIcon size={14} />
          {working ? "Memeriksa clipboard..." : "Tempel dari clipboard"}
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
            dragging
              ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
              : "border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-300"
          }`}
        >
          <UploadIcon size={20} />
          <span className="text-xs font-medium">
            {dragging ? "Lepaskan untuk mengimpor" : "Seret / paste gambar QR"}
          </span>
          <span className="text-[13px] text-zinc-400 dark:text-zinc-500">
            atau klik untuk memilih file (png, jpeg, webp)
          </span>
        </button>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) importFile(file);
            event.target.value = "";
          }}
        />

        {error ? <FormError message={error} /> : null}

        {report ? (
          <div className="space-y-2 rounded-xl border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-950/60">
            <div className="flex gap-3 text-xs">
              <span className="font-medium text-emerald-600 dark:text-emerald-400">
                {report.imported} masuk
              </span>
              <span className="text-zinc-500">{report.skipped} duplikat</span>
              <span className="text-red-600 dark:text-red-400">{report.failed} gagal</span>
            </div>

            {report.issues.length > 0 ? (
              <ul className="max-h-40 space-y-1 overflow-y-auto text-[13px] text-zinc-500 dark:text-zinc-400">
                {report.issues.map((issue, index) => (
                  <li key={`${issue.value}-${index}`} className="truncate">
                    <span className="font-medium">{issue.reason}:</span>{" "}
                    <span className="font-mono">{issue.value.slice(0, 80)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
