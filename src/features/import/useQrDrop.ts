import { useCallback, useEffect, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";

import { api } from "../../api/tauri";
import type { ImportReport } from "../../api/types";
import { pickDropTextPayload, readFileAsBase64, type DropPayload } from "../../lib/qr-drop";

/** Re-exported so consumers can type their drop handlers. */
export type { DropPayload };

/** Resolve everything a drop can carry; files win over text payloads. */
export async function resolveDropPayload(data: DataTransfer): Promise<DropPayload | null> {
  const files = data?.files ?? [];
  const image = Array.from(files).find((file) => file.type.startsWith("image/"));
  if (image) return { kind: "file", file: image };
  return data ? pickDropTextPayload(data) : null;
}

/** Route a resolved drop payload to the matching import command. */
export function importDropPayload(payload: DropPayload): Promise<ImportReport> {
  switch (payload.kind) {
    case "file":
      return readFileAsBase64(payload.file).then((base64) => api.importQrBytes(base64));
    case "image":
      return api.importQrBytes(payload.base64);
    case "path":
      return api.importQrFromPath(payload.path);
    case "url":
      return api.importQrUrl(payload.url);
    case "uri":
      return api.importText(payload.text);
  }
}

/** Drag & drop props for one element (the modal's dashed drop zone). */
export function useQrDropZone(onPayload: (payload: DropPayload) => void) {
  const [dragging, setDragging] = useState(false);
  const onPayloadRef = useRef(onPayload);
  onPayloadRef.current = onPayload;

  const onDragOver = useCallback((event: ReactDragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  }, []);

  const onDragLeave = useCallback((event: ReactDragEvent) => {
    const next = event.relatedTarget as Node | null;
    if (!next || !event.currentTarget.contains(next)) setDragging(false);
  }, []);

  const onDrop = useCallback((event: ReactDragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
    void resolveDropPayload(event.dataTransfer).then((payload) => {
      if (payload) onPayloadRef.current(payload);
    });
  }, []);

  return { dragging, onDragOver, onDragLeave, onDrop };
}

/** Window-wide drop target — lets a QR be dropped anywhere on the screen.
 *  `enabled` stays false while a modal is open, so the modal's own zone
 *  handles those drops instead (no double import). */
export function useQrDropWindow(onPayload: (payload: DropPayload) => void, enabled: boolean) {
  const [dragging, setDragging] = useState(false);
  const onPayloadRef = useRef(onPayload);
  onPayloadRef.current = onPayload;

  useEffect(() => {
    if (!enabled) return;

    // drags that end outside the window never fire drop — expire the
    // highlight so it cannot get stuck on screen.
    let staleTimer = 0;

    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      setDragging(true);
      window.clearTimeout(staleTimer);
      staleTimer = window.setTimeout(() => setDragging(false), 400);
    };
    const onDragLeave = (event: DragEvent) => {
      if (!event.relatedTarget) setDragging(false);
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      window.clearTimeout(staleTimer);
      setDragging(false);
      const data = event.dataTransfer;
      if (!data) return;
      void resolveDropPayload(data).then((payload) => {
        if (payload) onPayloadRef.current(payload);
      });
    };

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.clearTimeout(staleTimer);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [enabled]);

  return { dragging };
}
