"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ProgressDetails = {
  completedSections: number;
  totalSections: number;
  generatedWords: number;
  targetWords: number;
  currentSectionTitle: string | null;
  currentChapterTitle: string | null;
};

type ProgressState = {
  status: string;
  progress: number;
  details: ProgressDetails;
};

type AutopilotState = "registering" | "ready" | "retrying";

const emptyDetails: ProgressDetails = {
  completedSections: 0,
  totalSections: 0,
  generatedWords: 0,
  targetWords: 0,
  currentSectionTitle: null,
  currentChapterTitle: null
};

function statusLabel(status: string) {
  if (status === "GENERATING") return "AI가 원고를 작성하고 있습니다";
  if (status === "PAUSED") return "생성이 일시정지됐습니다";
  if (status === "COMPLETED") return "책 생성이 완료됐습니다";
  if (status === "FAILED") return "생성 상태를 확인해주세요";
  if (status === "CANCELLED") return "생성이 취소됐습니다";
  if (status === "PLANNING") return "책 구조를 설계하고 있습니다";
  return "책 생성 준비";
}

export function GenerationProgress({ bookId }: { bookId: string }) {
  const [state, setState] = useState<ProgressState | null>(null);
  const [autopilotState, setAutopilotState] = useState<AutopilotState>("registering");
  const autopilotRegistered = useRef(false);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/books/${bookId}/status`, { cache: "no-store" });
    if (!response.ok) return;
    const data = await response.json();
    setState({
      status: String(data.book?.status ?? "DRAFT"),
      progress: Math.max(0, Math.min(100, Number(data.book?.progress ?? 0))),
      details: data.progressDetails ?? emptyDetails
    });
  }, [bookId]);

  useEffect(() => {
    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const registerAutopilot = async () => {
      if (!active || autopilotRegistered.current) return;
      try {
        const response = await fetch(`/api/books/${bookId}/autopilot`, {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store"
        });
        if (response.ok) {
          autopilotRegistered.current = true;
          if (active) setAutopilotState("ready");
          return;
        }
      } catch {
        // Retry while this page is available. Once registration succeeds the
        // server Workflow no longer depends on this browser or phone.
      }
      if (active) {
        setAutopilotState("retrying");
        retryTimer = setTimeout(() => { void registerAutopilot(); }, 5000);
      }
    };

    void registerAutopilot();
    return () => {
      active = false;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [bookId]);

  useEffect(() => {
    const initialTimer = setTimeout(() => { void refresh(); }, 0);
    const timer = setInterval(() => { void refresh(); }, 2000);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(timer);
    };
  }, [refresh]);

  if (!state) return null;

  const { details } = state;
  const currentPath = [details.currentChapterTitle, details.currentSectionTitle].filter(Boolean).join(" › ");
  const isIdleDraft = state.status === "DRAFT"
    && state.progress <= 0
    && details.completedSections <= 0
    && details.generatedWords <= 0
    && !currentPath;
  if (isIdleDraft) return null;

  const sectionText = details.totalSections > 0
    ? `${details.completedSections} / ${details.totalSections} Sections`
    : "목차 준비 중";
  const wordText = details.targetWords > 0
    ? `${details.generatedWords.toLocaleString("ko-KR")} / ${details.targetWords.toLocaleString("ko-KR")} words`
    : `${details.generatedWords.toLocaleString("ko-KR")} words`;
  const autopilotText = autopilotState === "ready" ? "서버 자동 실행" : autopilotState === "retrying" ? "서버 등록 재시도 중" : "서버 등록 중";

  return (
    <section className={`generation-dock dock-${state.status.toLowerCase()}`} aria-live="polite" aria-label="책 생성 진행률">
      <div className="dock-main">
        <div className="dock-progress-number"><strong>{Math.round(state.progress)}</strong><span>%</span></div>
        <div className="dock-copy">
          <strong>{statusLabel(state.status)}</strong>
          <span>{sectionText} · {wordText} · {autopilotText}</span>
        </div>
        {currentPath && state.status !== "COMPLETED" && <div className="dock-current"><span>현재 작업</span><strong>{currentPath}</strong></div>}
      </div>
      <div className="dock-track" aria-hidden="true"><span style={{ width: `${state.progress}%` }} /></div>
    </section>
  );
}
