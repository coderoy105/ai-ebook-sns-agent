"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./export-download-guard.module.css";

type DownloadState = {
  format: string;
  phase: "preparing" | "done" | "error";
  message: string;
} | null;

function exportInfo(href: string) {
  try {
    const url = new URL(href, window.location.origin);
    const match = url.pathname.match(/^\/api\/books\/[^/]+\/export\/([^/]+)$/i);
    return match ? { url, format: match[1].toUpperCase() } : null;
  } catch {
    return null;
  }
}

function downloadFilename(response: Response, fallbackFormat: string) {
  const disposition = response.headers.get("content-disposition") ?? "";
  const utf8 = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (utf8) {
    try { return decodeURIComponent(utf8); } catch { /* use fallback */ }
  }
  const quoted = disposition.match(/filename="([^"]+)"/i)?.[1];
  if (quoted) return quoted;
  return `AI-Book-Studio.${fallbackFormat.toLowerCase()}`;
}

async function responseError(response: Response) {
  try {
    const payload = await response.json() as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  } catch { /* response may not be JSON */ }
  return `다운로드 준비에 실패했습니다. (HTTP ${response.status})`;
}

export function ExportDownloadGuard() {
  const [state, setState] = useState<DownloadState>(null);
  const busyRef = useRef(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function scheduleClear(delay: number) {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(() => setState(null), delay);
    }

    async function run(anchor: HTMLAnchorElement, format: string, url: URL) {
      if (busyRef.current) return;
      busyRef.current = true;
      anchor.setAttribute("aria-busy", "true");
      setState({ format, phase: "preparing", message: `${format} 파일을 준비하고 있습니다…` });

      try {
        const response = await fetch(url.toString(), {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          headers: { accept: format === "PDF" ? "application/pdf" : "*/*" }
        });
        if (!response.ok) throw new Error(await responseError(response));

        const blob = await response.blob();
        if (!blob.size) throw new Error("생성된 파일이 비어 있습니다.");

        const blobUrl = URL.createObjectURL(blob);
        const download = document.createElement("a");
        download.href = blobUrl;
        download.download = downloadFilename(response, format);
        download.rel = "noopener";
        download.style.display = "none";
        document.body.appendChild(download);
        download.click();
        download.remove();
        setTimeout(() => URL.revokeObjectURL(blobUrl), 15_000);

        setState({ format, phase: "done", message: `${format} 다운로드를 시작했습니다.` });
        scheduleClear(2800);
      } catch (error) {
        const message = error instanceof Error ? error.message : "파일 다운로드에 실패했습니다.";
        setState({ format, phase: "error", message });
        scheduleClear(8000);
      } finally {
        anchor.removeAttribute("aria-busy");
        busyRef.current = false;
      }
    }

    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a.export-link");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const info = exportInfo(anchor.href);
      if (!info) return;
      event.preventDefault();
      void run(anchor, info.format, info.url);
    }

    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, []);

  if (!state) return null;
  return (
    <div
      className={`${styles.notice} ${state.phase === "error" ? styles.error : ""}`}
      role={state.phase === "error" ? "alert" : "status"}
      aria-live="polite"
    >
      <span className={styles.format}>{state.format}</span>
      <span>{state.message}</span>
      {state.phase === "preparing" && <span className={styles.progress} aria-hidden="true" />}
    </div>
  );
}
