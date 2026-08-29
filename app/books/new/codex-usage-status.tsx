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

  return (
    <section className="research-note" aria-live="polite" style={{ marginBottom: 18 }}>
      <strong>GPT-5.6 Luna · {prettyPlan(status.planType)} 연결됨</strong>
      <p>
        {status.modelAvailable === false
          ? "현재 Codex model/list에서 GPT-5.6 Luna를 찾지 못했습니다."
          : primaryUsed == null
            ? "Codex 연결은 정상입니다. 현재 계정에서 사용량 퍼센트 정보가 제공되지 않았습니다."
            : `Codex 사용량 ${primaryUsed}%${reset ? ` · 다음 초기화 ${reset}` : ""}${secondaryUsed == null ? "" : ` · 보조 한도 ${secondaryUsed}%`}`}
      </p>
      {primaryUsed != null && (
        <div className="progress-track" aria-label={`Codex 사용량 ${primaryUsed}%`}>
          <span style={{ width: `${primaryUsed}%` }} />
        </div>
      )}
    </section>
  );
}
