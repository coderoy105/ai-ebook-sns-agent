"use client";

import { useEffect, useMemo, useState } from "react";
import { BookCoverArt } from "./book-cover-art";
import { normalizeCoverConcept } from "@/lib/design/cover-system";
import styles from "./cover-studio.module.css";

export type CoverRow = {
  id: string;
  concept: unknown;
  is_selected?: boolean;
  created_at?: string;
};

type Props = {
  bookId: string;
  title: string;
  subtitle?: string | null;
  bookType?: string | null;
  initialCovers?: CoverRow[];
};

export function CoverStudio({ bookId, title, subtitle, bookType, initialCovers = [] }: Props) {
  const [covers, setCovers] = useState<CoverRow[]>(initialCovers);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const selected = useMemo(() => covers.find((cover) => cover.is_selected) ?? covers[0] ?? null, [covers]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/books/${bookId}/covers`, { credentials: "same-origin", cache: "no-store" });
        const payload = await response.json().catch(() => ({})) as { covers?: CoverRow[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "표지 시안을 불러오지 못했습니다.");
        if (active && payload.covers) setCovers(payload.covers);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "표지 시안을 불러오지 못했습니다.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [bookId]);

  async function request(body: Record<string, unknown>) {
    const response = await fetch(`/api/books/${bookId}/covers`, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({})) as { covers?: CoverRow[]; error?: string };
    if (!response.ok) throw new Error(payload.error || "표지 작업에 실패했습니다.");
    if (payload.covers) setCovers(payload.covers);
  }

  async function selectCover(coverId: string) {
    if (busy || selected?.id === coverId) return;
    setBusy(true); setError("");
    try { await request({ action: "select", coverId }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "표지 선택에 실패했습니다."); }
    finally { setBusy(false); }
  }

  async function regenerate() {
    if (busy) return;
    setBusy(true); setError("");
    try { await request({ action: "regenerate" }); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "새 표지 시안 생성에 실패했습니다."); }
    finally { setBusy(false); }
  }

  const selectedConcept = normalizeCoverConcept(selected?.concept, { title, subtitle, bookType });

  return (
    <div className={styles.studio}>
      <div className={styles.header}>
        <div>
          <h4>표지 스튜디오</h4>
          <p>책의 핵심 상징과 장르 cliché를 분리해 서로 다른 출판 방향 3개를 설계합니다.</p>
        </div>
        <button type="button" className={styles.regenerate} disabled={busy || loading} onClick={regenerate}>{busy ? "작업 중…" : "새 3안"}</button>
      </div>

      {loading && !covers.length ? <p className={styles.detail}>표지 방향을 설계하고 있습니다…</p> : null}

      {covers.length ? (
        <div className={styles.grid}>
          {covers.slice(0, 3).map((cover) => {
            const concept = normalizeCoverConcept(cover.concept, { title, subtitle, bookType });
            const isSelected = cover.id === selected?.id;
            return (
              <button
                type="button"
                key={cover.id}
                className={`${styles.option} ${isSelected ? styles.selected : ""}`}
                onClick={() => void selectCover(cover.id)}
                aria-pressed={isSelected}
                disabled={busy}
              >
                <div className={styles.preview}>
                  <BookCoverArt concept={concept} title={title} subtitle={subtitle} bookType={bookType} />
                  {isSelected ? <span className={styles.selectedBadge}>SELECTED</span> : null}
                </div>
                <div className={styles.meta}>
                  <strong>{concept.styleLabel}</strong>
                  <span>{concept.palette.name}</span>
                </div>
              </button>
            );
          })}
        </div>
      ) : null}

      {covers.length ? (
        <div className={styles.detail}>
          <strong>{selectedConcept.motifLabel} · {selectedConcept.styleLabel}</strong>
          <p>{selectedConcept.rationale}</p>
          <p>피하는 표현: {selectedConcept.avoidCliches.slice(0, 3).join(" · ")}</p>
        </div>
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </div>
  );
}
