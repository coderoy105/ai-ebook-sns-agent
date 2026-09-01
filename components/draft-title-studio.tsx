"use client";

import { useState } from "react";
import { getFreeAiKey } from "@/lib/ai/openrouter-browser";
import styles from "./draft-title-studio.module.css";

type Suggestion = { title: string; reason: string; angle: string };

type Props = {
  value: string;
  onChange: (value: string) => void;
  idea: string;
  bookType: string;
  audience: string;
  ageGroup: string;
  tone: string;
  aiProvider: "openrouter" | "codex";
  onConnect: () => Promise<void>;
};

export function DraftTitleStudio({ value, onChange, idea, bookType, audience, ageGroup, tone, aiProvider, onConnect }: Props) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function recommend() {
    if (busy || idea.trim().length < 8) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (aiProvider === "openrouter") {
        const key = getFreeAiKey();
        if (key) headers["x-openrouter-key"] = key;
      }
      const response = await fetch("/api/title-suggestions", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers,
        body: JSON.stringify({ idea, bookType, audience, ageGroup, tone, aiProvider })
      });
      const payload = await response.json().catch(() => ({})) as {
        suggestions?: Suggestion[];
        providerLabel?: string;
        error?: string;
        reconnect?: boolean;
      };
      if (response.status === 428 || payload.reconnect) {
        setBusy(false);
        await onConnect();
        setNote("AI 연결을 완료한 뒤 ‘AI 제목 5개 추천’을 다시 눌러 주세요.");
        return;
      }
      if (!response.ok) {
        const message = payload.error === "CODEX_USAGE_LIMIT" ? "ChatGPT/Codex 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요."
          : payload.error === "FREE_AI_DAILY_LIMIT" ? "무료 AI 일일 한도에 도달했습니다."
            : payload.error === "CODEX_LUNA_UNAVAILABLE" ? "현재 ChatGPT 계정에서는 GPT-5.6 Luna를 사용할 수 없습니다."
              : payload.error || "AI 제목 추천에 실패했습니다.";
        throw new Error(message);
      }
      setSuggestions(payload.suggestions ?? []);
      setNote(`${payload.providerLabel ?? "AI"}가 제목 후보 5개를 만들었습니다. 마음에 드는 제목을 누른 뒤 직접 다듬어도 됩니다.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI 제목 추천에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.studio} aria-label="책 제목 정하기">
      <div className={styles.heading}>
        <div><span>BOOK NAMING · OPTIONAL</span><strong>제목은 직접 정하거나 AI에게 맡길 수 있습니다.</strong></div>
        <button type="button" disabled={busy || idea.trim().length < 8} onClick={() => void recommend()}>{busy ? "추천 중…" : "AI 제목 5개 추천"}</button>
      </div>

      <div className={styles.field}>
        <input
          aria-label="책 제목"
          value={value}
          maxLength={160}
          onChange={(event) => onChange(event.target.value)}
          placeholder="직접 제목을 입력하세요 · 비워두면 AI가 Blueprint에서 최종 제목을 정합니다."
        />
        <div><span>{value.trim() ? "이 제목을 최종 제목으로 보호합니다." : "아직 제목을 정하지 않아도 됩니다."}</span><b>{value.trim().length}/160</b></div>
      </div>

      {suggestions.length ? (
        <div className={styles.suggestions}>
          {suggestions.map((suggestion, index) => {
            const selected = value.trim() === suggestion.title.trim();
            return (
              <button type="button" key={`${suggestion.title}-${index}`} className={selected ? styles.selected : ""} onClick={() => onChange(suggestion.title)}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <div><small>{suggestion.angle}</small><strong>{suggestion.title}</strong><p>{suggestion.reason}</p></div>
                <i>{selected ? "선택됨" : "선택"}</i>
              </button>
            );
          })}
        </div>
      ) : null}

      {note ? <p className={styles.note} aria-live="polite">{note}</p> : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
    </section>
  );
}
