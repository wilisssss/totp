/** HTML5 drag & drop payload parsing for the QR import flow.
 *
 * The Tauri-native drag handler only sees filesystem paths (GTK `file://`
 * URIs), so dragging an image out of a browser — whose payload is a
 * `data:image/png;base64,...` URL, an `<img>` snippet, or a remote link —
 * arrived with no paths at all and silently did nothing. The webview
 * therefore runs with the native handler disabled (`dragDropEnabled: false`)
 * and the DOM `drop` event is parsed here instead.
 *
 * Everything is structural (no DOM APIs beyond the `File` type) so the
 * parsing can be unit tested in Node. */

export type DropPayload =
  | { kind: "image"; base64: string }
  | { kind: "file"; file: File }
  | { kind: "path"; path: string }
  | { kind: "url"; url: string }
  | { kind: "uri"; text: string };

/** Minimal DataTransfer surface we rely on — structural for Node tests. */
export interface DragDataLike {
  getData(type: string): string;
}

const DATA_URL_RE = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=\s]+)$/i;
// A URL scheme needs at least two characters — this keeps Windows drive
// paths (`C:\...`) out of the scheme branch.
const SCHEME_RE = /^[a-z][a-z0-9+.-]+:/i;
const OTPAUTH_RE = /^otpauth(-migration)?:\/\//i;
const WINDOWS_PATH_RE = /^[a-z]:[\\/]/i;

/** First usable line of a `text/uri-list` payload (comments start with `#`). */
export function firstUriListEntry(value: string): string {
  for (const line of value.split(/\r?\n/)) {
    const entry = line.trim();
    if (entry && !entry.startsWith("#")) return entry;
  }
  return "";
}

/** `src` attribute of the first `<img>` inside a `text/html` payload. */
export function imageSrcFromHtml(html: string): string {
  const match = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/i.exec(html);
  if (!match) return "";
  return (match[1] ?? match[2] ?? match[3] ?? "").trim();
}

/** Base64 body of a `data:image/...;base64,...` URL, or null. */
export function base64FromDataUrl(value: string): string | null {
  const match = DATA_URL_RE.exec(value.trim());
  if (!match) return null;
  const payload = match[1].replace(/\s+/g, "");
  return /[A-Za-z0-9+/]/.test(payload) ? payload : null;
}

/** Classify one candidate string handed over by a drag. */
export function classifyDropText(raw: string): DropPayload | null {
  const value = raw.trim().replace(/^["']|["']$/g, "");
  if (!value) return null;

  const base64 = base64FromDataUrl(value);
  if (base64) return { kind: "image", base64 };

  if (OTPAUTH_RE.test(value)) return { kind: "uri", text: value };

  if (SCHEME_RE.test(value)) {
    if (/^file:\/\//i.test(value)) {
      const path = value.slice("file://".length);
      try {
        return { kind: "path", path: decodeURIComponent(path) };
      } catch {
        return { kind: "path", path };
      }
    }
    if (/^https?:\/\//i.test(value)) return { kind: "url", url: value };
    return null; // javascript:, ftp:, ... — not importable
  }

  if (value.startsWith("/") || value.startsWith("~") || WINDOWS_PATH_RE.test(value)) {
    return { kind: "path", path: value };
  }
  return null;
}

/** All text candidates a DataTransfer carries, most specific first. */
export function collectDropTexts(data: DragDataLike): string[] {
  const read = (type: string): string => {
    try {
      return data.getData(type) ?? "";
    } catch {
      // Firefox forbids getData outside drop; never let that throw.
      return "";
    }
  };

  const candidates = [
    firstUriListEntry(read("text/uri-list")),
    read("text/plain").trim(),
    imageSrcFromHtml(read("text/html")),
  ];

  const seen = new Set<string>();
  return candidates.filter((text) => {
    if (!text || seen.has(text)) return false;
    seen.add(text);
    return true;
  });
}

/** Which payload kind wins when a drag carries several candidates:
 *  a guaranteed-decodable data URL beats a remote URL that needs a download. */
const KIND_RANK: Record<DropPayload["kind"], number> = {
  image: 0,
  uri: 1,
  path: 2,
  file: 2,
  url: 3,
};

/** Best usable payload from the text part of a drag, or null. */
export function pickDropTextPayload(data: DragDataLike): DropPayload | null {
  const payloads = collectDropTexts(data)
    .map((text) => classifyDropText(text))
    .filter((payload): payload is DropPayload => payload !== null);
  if (payloads.length === 0) return null;
  return payloads.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind])[0];
}

/** Read a dropped image file as bare base64 (no data URL prefix). */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const comma = dataUrl.indexOf(",");
      const payload = comma >= 0 ? dataUrl.slice(comma + 1).replace(/\s+/g, "") : "";
      if (/^[A-Za-z0-9+/=]+$/.test(payload) && payload.length > 0) {
        resolve(payload);
      } else {
        reject(new Error("Bukan file gambar yang bisa dibaca"));
      }
    };
    reader.onerror = () => reject(new Error("Gagal membaca file gambar"));
    reader.readAsDataURL(file);
  });
}
