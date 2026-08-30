"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./export-download-guard.module.css";

type DownloadState = {
  format: string;
  phase: "preparing" | "generating" | "downloading" | "done" | "error";
  message: string;
  progress: number;
} | null;

type ExportStatus = {
  jobId?: string;
  status?: string;
  progress?: number;
  phase?: string;
  message?: string;
  background?: boolean;
  ready?: boolean;
};

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

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  const kb = value / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function responseError(response: Response) {
  try {
    const payload = await response.json() as { error?: unknown };
    if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  } catch { /* response may not be JSON */ }
  return `다운로드 준비에 실패했습니다. (HTTP ${response.status})`;
}

async function readResponseWithProgress(
  response: Response,
  format: string,
  onProgress: (received: number, total: number, percent: number) => void
) {
  const total = Number(response.headers.get("content-length") ?? 0);
  if (!response.body) {
    const blob = await response.blob();
    onProgress(blob.size, blob.size, 100);
    return blob;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  let lastPercent = -1;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    chunks.push(value);
    received += value.byteLength;

    const percent = total > 0
      ? Math.min(99, Math.max(0, Math.floor((received / total) * 100)))
      : 0;
    if (percent !== lastPercent) {
      lastPercent = percent;
      onProgress(received, total, percent);
    }
  }

  if (received === 0) throw new Error("생성된 파일이 비어 있습니다.");

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  onProgress(received, total || received, 100);
  return new Blob([bytes], {
    type: response.headers.get("content-type") ?? (format === "PDF" ? "application/pdf" : "application/octet-stream")
  });
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
      setState({
        format,
        phase: "preparing",
        progress: 1,
        message: `${format} 1% · 백그라운드 작업을 준비하고 있습니다. 앱을 닫아도 계속 진행됩니다.`
      });

      try {
        const startResponse = await fetch(url.toString(), {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store"
        });
        if (!startResponse.ok) throw new Error(await responseError(startResponse));
        const started = await startResponse.json() as { jobId?: string; status?: string; background?: boolean };
        if (!started.jobId) throw new Error("다운로드 작업 ID를 만들지 못했습니다.");
        const jobId = started.jobId;

        const statusUrl = new URL(`${url.pathname}/status`, url.origin);
        statusUrl.searchParams.set("jobId", jobId);
        const downloadUrl = new URL(url.toString());
        downloadUrl.searchParams.set("jobId", jobId);

        while (true) {
          const response = await fetch(statusUrl.toString(), {
            credentials: "same-origin",
            cache: "no-store"
          });
          if (!response.ok) throw new Error(await responseError(response));
          const payload = await response.json() as ExportStatus;
          if (payload.status === "FAILED") throw new Error(payload.message || `${format} 생성에 실패했습니다.`);

          const progress = Math.max(1, Math.min(90, Math.round(payload.progress ?? 2)));
          setState({
            format,
            phase: "generating",
            progress,
            message: `${format} ${progress}% · ${payload.message || "백그라운드에서 파일을 만들고 있습니다. 앱을 닫아도 계속 진행됩니다."}`
          });

          if (payload.status === "COMPLETED" && payload.ready !== false) break;
          await sleep(document.visibilityState === "hidden" ? 2500 : 700);
        }

        const response = await fetch(downloadUrl.toString(), {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
          headers: { accept: format === "PDF" ? "application/pdf" : "*/*" }
        });
        if (!response.ok) throw new Error(await responseError(response));

        const total = Number(response.headers.get("content-length") ?? 0);
        setState({
          format,
          phase: "downloading",
          progress: 90,
          message: total > 0
            ? `${format} 90% · 완성 파일 다운로드 시작 · 0 B / ${formatBytes(total)}`
            : `${format} 90% · 완성 파일 다운로드를 시작합니다.`
        });

        const blob = await readResponseWithProgress(response, format, (received, expected, transferPercent) => {
          const overall = transferPercent >= 100 ? 100 : Math.min(99, 90 + Math.floor(transferPercent / 10));
          setState({
            format,
            phase: "downloading",
            progress: overall,
            message: expected > 0
              ? `${format} ${overall}% · 다운로드 ${transferPercent}% · ${formatBytes(received)} / ${formatBytes(expected)}`
              : `${format} ${overall}% · 다운로드 중 · ${formatBytes(received)}`
          });
        });

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

        setState({ format, phase: "done", progress: 100, message: `${format} 100% · 파일 저장을 시작했습니다.` });
        scheduleClear(3600);
      } catch (error) {
        const message = error instanceof Error ? error.message : "파일 다운로드에 실패했습니다.";
        setState({ format, phase: "error", progress: 0, message });
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
      <span className={styles.message}>{state.message}</span>
      {state.phase !== "error" && (
        <div
          className={styles.progressTrack}
          role="progressbar"
          aria-label={`${state.format} 파일 준비 진행률`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={state.progress}
        >
          <span className={styles.progressFill} style={{ width: `${state.progress}%` }} />
        </div>
      )}
    </div>
  );
}
