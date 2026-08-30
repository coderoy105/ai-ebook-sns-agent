"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./export-download-guard.module.css";

type DownloadPhase = "preparing" | "generating" | "ready" | "downloading" | "done" | "error";
type DownloadState = {
  format: string;
  phase: DownloadPhase;
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
  stale?: boolean;
  updatedAt?: string | null;
};

type ExportTarget = {
  url: URL;
  format: string;
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
    if (typeof payload.error === "string" && payload.error.trim()) {
      if (payload.error === "EXPORT_NOT_READY") return "PDF는 백그라운드에서 계속 생성 중입니다.";
      return payload.error;
    }
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

function statusUrlFor(target: ExportTarget, jobId?: string | null) {
  const url = new URL(`${target.url.pathname}/status`, target.url.origin);
  if (jobId) url.searchParams.set("jobId", jobId);
  return url;
}

function downloadUrlFor(target: ExportTarget, jobId: string) {
  const url = new URL(target.url.toString());
  url.searchParams.set("jobId", jobId);
  return url;
}

export function ExportDownloadGuard() {
  const [state, setState] = useState<DownloadState>(null);
  const busyRef = useRef(false);
  const monitorTokenRef = useRef(0);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let disposed = false;

    function scheduleClear(delay: number) {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(() => setState(null), delay);
    }

    function renderStatus(format: string, payload: ExportStatus) {
      const progress = Math.max(1, Math.min(90, Math.round(payload.progress ?? 2)));
      setState({
        format,
        phase: payload.status === "COMPLETED" ? "ready" : "generating",
        progress,
        message: payload.status === "COMPLETED"
          ? `${format} 90% · 백그라운드 생성 완료 · ${format} 버튼을 누르면 바로 다운로드됩니다.`
          : `${format} ${progress}% · ${payload.message || "백그라운드에서 파일을 만들고 있습니다. 앱을 닫아도 계속 진행됩니다."}`
      });
    }

    async function fetchStatus(target: ExportTarget, jobId?: string | null) {
      const response = await fetch(statusUrlFor(target, jobId).toString(), {
        credentials: "same-origin",
        cache: "no-store"
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(await responseError(response));
      return response.json() as Promise<ExportStatus>;
    }

    async function startOrReuse(target: ExportTarget) {
      const response = await fetch(target.url.toString(), {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store"
      });
      if (!response.ok) throw new Error(await responseError(response));
      const payload = await response.json() as ExportStatus;
      if (!payload.jobId) throw new Error("다운로드 작업 ID를 만들지 못했습니다.");
      return payload;
    }

    async function downloadReadyArtifact(target: ExportTarget, jobId: string, token: number) {
      const response = await fetch(downloadUrlFor(target, jobId).toString(), {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { accept: target.format === "PDF" ? "application/pdf" : "*/*" }
      });
      if (!response.ok) throw new Error(await responseError(response));
      if (disposed || monitorTokenRef.current !== token) return;

      const total = Number(response.headers.get("content-length") ?? 0);
      setState({
        format: target.format,
        phase: "downloading",
        progress: 90,
        message: total > 0
          ? `${target.format} 90% · 완성 파일 다운로드 시작 · 0 B / ${formatBytes(total)}`
          : `${target.format} 90% · 완성 파일 다운로드를 시작합니다.`
      });

      const blob = await readResponseWithProgress(response, target.format, (received, expected, transferPercent) => {
        if (disposed || monitorTokenRef.current !== token) return;
        const overall = transferPercent >= 100 ? 100 : Math.min(99, 90 + Math.floor(transferPercent / 10));
        setState({
          format: target.format,
          phase: "downloading",
          progress: overall,
          message: expected > 0
            ? `${target.format} ${overall}% · 다운로드 ${transferPercent}% · ${formatBytes(received)} / ${formatBytes(expected)}`
            : `${target.format} ${overall}% · 다운로드 중 · ${formatBytes(received)}`
        });
      });

      if (disposed || monitorTokenRef.current !== token) return;
      const blobUrl = URL.createObjectURL(blob);
      const download = document.createElement("a");
      download.href = blobUrl;
      download.download = downloadFilename(response, target.format);
      download.rel = "noopener";
      download.style.display = "none";
      document.body.appendChild(download);
      download.click();
      download.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 15_000);

      setState({
        format: target.format,
        phase: "done",
        progress: 100,
        message: `${target.format} 100% · 파일 저장을 시작했습니다.`
      });
      scheduleClear(3600);
    }

    async function monitor(target: ExportTarget, jobId: string, autoDownload: boolean, token: number) {
      while (!disposed && monitorTokenRef.current === token) {
        if (document.visibilityState === "hidden") {
          await sleep(3000);
          continue;
        }

        const payload = await fetchStatus(target, jobId);
        if (!payload) throw new Error("백그라운드 다운로드 작업을 찾지 못했습니다.");
        if (payload.status === "FAILED") throw new Error(payload.message || `${target.format} 생성에 실패했습니다.`);
        if (payload.stale) {
          setState({
            format: target.format,
            phase: "preparing",
            progress: 1,
            message: `${target.format} · 중단된 이전 작업을 자동으로 복구하고 있습니다.`
          });
          const restarted = await startOrReuse(target);
          if (!restarted.jobId) throw new Error("백그라운드 작업 복구에 실패했습니다.");
          jobId = restarted.jobId;
          continue;
        }

        renderStatus(target.format, payload);
        if (payload.status === "COMPLETED" && payload.ready !== false) {
          if (autoDownload) await downloadReadyArtifact(target, jobId, token);
          return;
        }
        await sleep(900);
      }
    }

    async function run(anchor: HTMLAnchorElement, target: ExportTarget) {
      if (busyRef.current) return;
      busyRef.current = true;
      anchor.setAttribute("aria-busy", "true");
      const token = monitorTokenRef.current + 1;
      monitorTokenRef.current = token;
      setState({
        format: target.format,
        phase: "preparing",
        progress: 1,
        message: `${target.format} 1% · 백그라운드 작업을 확인하고 있습니다. 앱을 닫아도 계속 진행됩니다.`
      });

      try {
        const started = await startOrReuse(target);
        if (started.status === "COMPLETED" && started.ready !== false) {
          await downloadReadyArtifact(target, started.jobId!, token);
        } else {
          await monitor(target, started.jobId!, true, token);
        }
      } catch (error) {
        if (!disposed && monitorTokenRef.current === token) {
          const message = error instanceof Error ? error.message : "파일 다운로드에 실패했습니다.";
          setState({ format: target.format, phase: "error", progress: 0, message });
          scheduleClear(8000);
        }
      } finally {
        anchor.removeAttribute("aria-busy");
        busyRef.current = false;
      }
    }

    async function restoreBackgroundJob() {
      await sleep(0);
      const links = Array.from(document.querySelectorAll("a.export-link"))
        .filter((node): node is HTMLAnchorElement => node instanceof HTMLAnchorElement)
        .map((anchor) => exportInfo(anchor.href))
        .filter((value): value is ExportTarget => Boolean(value));
      if (!links.length || disposed) return;

      const params = new URLSearchParams(window.location.search);
      const preferredFormat = params.get("export")?.toUpperCase() ?? null;
      const preferredJobId = params.get("jobId");
      links.sort((a, b) => {
        if (a.format === preferredFormat) return -1;
        if (b.format === preferredFormat) return 1;
        if (a.format === "PDF") return -1;
        if (b.format === "PDF") return 1;
        return 0;
      });

      for (const target of links) {
        try {
          const explicitJobId = target.format === preferredFormat ? preferredJobId : null;
          const payload = await fetchStatus(target, explicitJobId);
          if (!payload?.jobId) continue;
          if (payload.status !== "QUEUED" && payload.status !== "RUNNING") continue;

          const token = monitorTokenRef.current + 1;
          monitorTokenRef.current = token;
          renderStatus(target.format, payload);
          void monitor(target, payload.jobId, false, token).catch((error) => {
            if (disposed || monitorTokenRef.current !== token) return;
            setState({
              format: target.format,
              phase: "error",
              progress: 0,
              message: error instanceof Error ? error.message : `${target.format} 백그라운드 작업 확인에 실패했습니다.`
            });
          });

          if (preferredFormat) {
            const clean = new URL(window.location.href);
            clean.searchParams.delete("export");
            clean.searchParams.delete("jobId");
            window.history.replaceState(null, "", `${clean.pathname}${clean.search}${clean.hash}`);
          }
          return;
        } catch {
          // Try the next format. A failed discovery must not break the editor.
        }
      }
    }

    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const targetNode = event.target;
      if (!(targetNode instanceof Element)) return;
      const anchor = targetNode.closest("a.export-link");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const info = exportInfo(anchor.href);
      if (!info) return;
      event.preventDefault();
      void run(anchor, info);
    }

    document.addEventListener("click", onClick, true);
    void restoreBackgroundJob();
    return () => {
      disposed = true;
      monitorTokenRef.current += 1;
      document.removeEventListener("click", onClick, true);
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
