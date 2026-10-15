import { useCallback, useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { readImage, readText } from "@tauri-apps/plugin-clipboard-manager";
import {
  Format,
  checkPermissions,
  requestPermissions,
  scan,
} from "@tauri-apps/plugin-barcode-scanner";

import { api, errorMessage } from "../../api/tauri";
import type { ImportReport } from "../../api/types";
import { Modal } from "../../components/ui/Modal";
import { FormError } from "../../components/ui/FormError";
import { CameraIcon, ClipboardIcon, UploadIcon } from "../../components/ui/icons";
import { useToast } from "../../components/ui/Toast";
import { useVault } from "../vault/VaultProvider";
import { importDropPayload, useQrDropZone, type DropPayload } from "./useQrDrop";
import { readFileAsBase64 } from "../../lib/qr-drop";

/** Android has no drag & drop and no desktop screenshot flow — it gets a
    camera scanner and the SAF file picker instead. */
const isAndroid = /android/i.test(navigator.userAgent);

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

  const importFile = useCallback(
    (file: File) => {
      void (async () => {
        await runImport(() =>
          readFileAsBase64(file).then((base64) => api.importQrBytes(base64)),
        );
      })();
    },
    [runImport],
  );

  /** Android: SAF picker returns a content URI — read it via the fs plugin. */
  const importAndroidFile = useCallback(async () => {
    const path = await openDialog({
      multiple: false,
      filters: [{ name: "Gambar", extensions: ["png", "jpg", "jpeg", "webp", "gif"] }],
    });
    if (!path) return;

    await runImport(async () => {
      const bytes = new Uint8Array(await readFile(path as string));
      return api.importQrBytes(bytesToBase64(bytes));
    });
  }, [runImport]);

  /** Android: scan a QR straight from the camera (ML Kit, full screen).
      The plugin throws unless the camera permission is already granted, so
      request it first — the system dialog shows on first use. */
  const scanCamera = useCallback(async () => {
    await runImport(async () => {
      let permission = await checkPermissions();
      if (permission !== "granted") {
        permission = await requestPermissions();
      }
      if (permission !== "granted") {
        throw new Error("Izin kamera ditolak — aktifkan di info aplikasi");
      }
      const scanned = await scan({ formats: [Format.QRCode] });
      const content = scanned.content.trim();
      if (!content) {
        throw new Error("Tidak ada QR yang terbaca");
      }
      return api.importText(content);
    });
  }, [runImport]);

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

  /** HTML5 drop zone: browser images arrive as data URLs / image files, not
      as filesystem paths, so the DOM event is parsed by hand. */
  const handleDropPayload = useCallback(
    (payload: DropPayload) => {
      void runImport(() => importDropPayload(payload));
    },
    [runImport],
  );
  const dropZone = useQrDropZone(handleDropPayload);

  // Ctrl+V with an image in the clipboard imports it directly.
  const importFileRef = useRef(importFile);
  importFileRef.current = importFile;

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

        {isAndroid ? (
          <button
            type="button"
            onClick={() => void scanCamera()}
            disabled={working}
            className="btn btn-primary w-full"
            title="Buka kamera dan pindai QR code"
          >
            <CameraIcon size={15} /> Pindai QR dengan kamera
          </button>
        ) : null}

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
          onDragOver={dropZone.onDragOver}
          onDragLeave={dropZone.onDragLeave}
          onDrop={dropZone.onDrop}
          onClick={() => (isAndroid ? void importAndroidFile() : fileInputRef.current?.click())}
          className={`flex w-full flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
            dropZone.dragging
              ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300"
              : "border-zinc-300 text-zinc-500 hover:border-zinc-400 hover:text-zinc-700 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-zinc-600 dark:hover:text-zinc-300"
          }`}
        >
          <UploadIcon size={20} />
          <span className="text-xs font-medium">
            {dropZone.dragging
              ? "Lepaskan untuk mengimpor"
              : isAndroid
                ? "Pilih gambar QR dari penyimpanan"
                : "Seret / paste gambar QR"}
          </span>
          {isAndroid ? null : (
            <span className="text-[13px] text-zinc-400 dark:text-zinc-500">
              atau klik untuk memilih file (png, jpeg, webp)
            </span>
          )}
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
