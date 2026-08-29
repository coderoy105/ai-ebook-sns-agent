"use client";

import { useCallback, useEffect, useState } from "react";

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

const emptyDetails: ProgressDetails = {
  completedSections: 0,
  totalSections: 0,
  generatedWords: 0,
  targetWords: 0,
  currentSectionTitle: null,
  currentChapterTitle: null
};

function statusLabel(status: string) {
  if (status === "GENERATING") return "AI가 책을 작성하고 있어요";
  if (status === "PAUSED") return "생성이 일시정지됐어요";
  if (status === "COMPLETED") return "책 생성 완료";
  if (status === "FAILED") return "생성 중 오류가 발생했어요";
  if (status === "CANCELLED") return "생성이 취소됐어요";
  if (status === "PLANNING") return "책 구조를 설계하고 있어요";
  return "책 생성 준비";
}

export function GenerationProgress({ bookId }: { bookId: string }) {
  const [state, setState] = useState<ProgressState | null>(null);

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
  const sectionText = details.totalSections > 0
    ? `${details.completedSections}/${details.totalSections} Sections 완료`
    : "목차 준비 중";
  const wordText = details.targetWords > 0
    ? `${details.generatedWords.toLocaleString("ko-KR")} / ${details.targetWords.toLocaleString("ko-KR")}단어`
    : `${details.generatedWords.toLocaleString("ko-KR")}단어 작성`;

  return (
    <section
      className="panel"
      aria-live="polite"
      aria-label="책 생성 진행률"
      style={{
        position: "fixed",
        left: "50%",
        bottom: 18,
        transform: "translateX(-50%)",
        zIndex: 50,
        width: "min(620px, calc(100vw - 28px))",
        padding: "14px 16px",
        boxShadow: "0 18px 50px rgba(0,0,0,.18)"
      }}
    >
      <div className="meta-row" style={{ marginBottom: 8 }}>
        <div>
          <strong>{statusLabel(state.status)}</strong>
          <div className="muted" style={{ fontSize: 12, marginTop: 3 }}>
            {sectionText} · {wordText}
          </div>
        </div>
        <strong style={{ fontSize: 22 }}>{Math.round(state.progress)}%</strong>
      </div>
      <div className="progress-track" aria-hidden="true">
        <span style={{ width: `${state.progress}%` }} />
      </div>
      {currentPath && state.status !== "COMPLETED" && (
        <div style={{ fontSize: 12, marginTop: 8 }}>
          <span className="muted">현재 작업 중 · </span><strong>{currentPath}</strong>
        </div>
      )}
    </section>
  );
}
