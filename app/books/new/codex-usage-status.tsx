"use client";

import { useEffect, useState } from "react";
import { getCodexConnectionStatus, type CodexConnectionStatus } from "@/lib/ai/codex-browser";

type RateLimitWindow = {
  usedPercent?: unknown;
  resetsAt?: unknown;
  windowDurationMins?: unknown;
};

type RateLimitSnapshot = {
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
  limitName?: unknown;
  rateLimitReachedType?: unknown;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function rateSnapshot(value: unknown): RateLimitSnapshot | null {
  const response = asObject(value);
  if (!response) return null;
  const snapshot = asObject(response.rateLimits) ?? response;
  return snapshot as RateLimitSnapshot;
}

function usedPercent(window: RateLimitWindow | null | undefined) {
  const value = Number(window?.usedPercent);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : null;
}

function resetLabel(window: RateLimitWindow | null | undefined) {
  const resetsAt = Number(window?.resetsAt);
  if (!Number.isFinite(resetsAt) || resetsAt <= 0) return null;
  const ms = resetsAt * 1000 - Date.now();
  if (ms <= 0) return "곧 초기화";
  const totalMinutes = Math.max(1, Math.ceil(ms / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}시간 ${minutes}분 후` : `${minutes}분 후`;
}

function prettyPlan(value: string | null | undefined) {
  if (!value) return "ChatGPT";
  if (value.toLowerCase() === "plus") return "ChatGPT Plus";
  return `ChatGPT ${value}`;
}

export function CodexUsageStatus() {
  const [status, setStatus] = useState<CodexConnectionStatus | null>(null);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void getCodexConnectionStatus()
        .then((next) => { if (active) setStatus(next); })
        .catch(() => { if (active) setStatus(null); });
    };
    refresh();
    const timer = setInterval(refresh, 60000);
    return () => { active = false; clearInterval(timer); };
  }, []);

  if (!status?.connected) return null;
  const snapshot = rateSnapshot(status.rateLimits);
  const primaryUsed = usedPercent(snapshot?.primary);
  const secondaryUsed = usedPercent(snapshot?.secondary);
  const reset = resetLabel(snapshot?.primary);
  const modelUnavailable = status.modelAvailable === false;

  return (
    <section className={`codex-usage-strip ${modelUnavailable ? "codex-usage-warning" : ""}`} aria-live="polite" aria-label="ChatGPT Codex 연결 상태">
      <div className="codex-usage-identity">
        <span className="status-dot" aria-hidden="true" />
        <div>
          <strong>GPT-5.6 Luna</strong>
          <small>{prettyPlan(status.planType)} · Codex OAuth</small>
        </div>
      </div>
      <div className="codex-usage-copy">
        <strong>{modelUnavailable ? "현재 계정에서 Luna를 사용할 수 없습니다." : "ChatGPT 연결됨"}</strong>
        <span>{modelUnavailable
          ? "Codex model/list에서 GPT-5.6 Luna가 확인되지 않았습니다."
          : primaryUsed == null
            ? "연결은 정상이며 현재 계정은 사용량 퍼센트를 제공하지 않았습니다."
            : `Codex 사용량 ${primaryUsed}%${reset ? ` · 초기화 ${reset}` : ""}${secondaryUsed == null ? "" : ` · 보조 한도 ${secondaryUsed}%`}`}</span>
      </div>
      {primaryUsed != null && !modelUnavailable ? (
        <div className="codex-usage-meter">
          <span>{primaryUsed}%</span>
          <div className="progress-track" aria-label={`Codex 사용량 ${primaryUsed}%`}><i style={{ width: `${primaryUsed}%` }} /></div>
        </div>
      ) : null}
    </section>
  );
}
