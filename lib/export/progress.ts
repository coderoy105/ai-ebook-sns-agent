export type ExportProgressPhase = "queued" | "collecting" | "rendering" | "merging" | "storing" | "ready";

export type ExportProgressPayload = {
  progress: number;
  phase: ExportProgressPhase;
  message: string;
};

const PROGRESS_PREFIX = "__EXPORT_PROGRESS__";

export function encodeExportProgress(payload: ExportProgressPayload) {
  return `${PROGRESS_PREFIX}${JSON.stringify({
    progress: Math.max(0, Math.min(90, payload.progress)),
    phase: payload.phase,
    message: payload.message
  })}`;
}

export function decodeExportProgress(value: string | null | undefined): ExportProgressPayload | null {
  if (!value?.startsWith(PROGRESS_PREFIX)) return null;
  try {
    const parsed = JSON.parse(value.slice(PROGRESS_PREFIX.length)) as Partial<ExportProgressPayload>;
    if (typeof parsed.progress !== "number" || typeof parsed.message !== "string" || typeof parsed.phase !== "string") return null;
    return {
      progress: Math.max(0, Math.min(90, parsed.progress)),
      phase: parsed.phase as ExportProgressPhase,
      message: parsed.message
    };
  } catch {
    return null;
  }
}
