"use client";

import { useState } from "react";
import { beginFreeAiConnect, getFreeAiKey } from "@/lib/ai/openrouter-browser";
import { connectCodexChatGPT, type CodexDeviceEvent } from "@/lib/ai/codex-browser";
import { ChatGptDeviceCodePanel } from "./chatgpt-device-code-panel";
import styles from "./title-studio-launcher.module.css";

type Suggestion = {
  title: string;
  reason: string;
  angle: string;
};

type Props = {
  bookId: string;
  title: string;
};

type DevicePrompt = { verificationUrl: string; userCode: string };

export function TitleStudioLauncher({ bookId, title }: Props) {
  const [open, setOpen] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [recommending, setRecommending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [devicePrompt, setDevicePrompt] = useState<DevicePrompt | null>(null);

  async function connectCodexAndRetry() {
    setError("");
    try {
      const result = await connectCodexChatGPT({
        openVerificationPage: false,
        onEvent(event: CodexDeviceEvent) {
          if (event.type === "device_code") setDevicePrompt({ verificationUrl: event.verificationUrl, userCode: event.userCode });
        }
      });
      setDevicePrompt(null);
      if (!result.modelAvailable) throw new Error("이 ChatGPT 계정에서는 GPT-5.6 Luna를 사용할 수 없습니다.");
      await recommendTitles(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "ChatGPT 연결에 실패했습니다.");
    }
  }

  async function recommendTitles(afterReconnect = false) {
    if (recommending) return;
    setRecommending(true);
    setError("");
    setMessage(afterReconnect ? "ChatGPT 연결이 완료되어 제목을 다시 추천하고 있습니다." : "");
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      const localKey = getFreeAiKey();
      if (localKey) headers["x-openrouter-key"] = localKey;
      const response = await fetch(`/api/books/${bookId}/title`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers,
        body: JSON.stringify({})
      });
      const payload = await response.json().catch(() => ({})) as {
        suggestions?: Suggestion[];
        error?: string;
        reconnect?: boolean;
        provider?: "openrouter" | "codex";
        providerLabel?: string;
      };
      if (response.status === 428 || payload.reconnect) {
        if (payload.provider === "codex") {
          setRecommending(false);
          await connectCodexAndRetry();
          return;
        }
        await beginFreeAiConnect(`/books/${bookId}`);
        return;
      }
      if (!response.ok) {
        const label = payload.error === "CODEX_USAGE_LIMIT" ? "ChatGPT/Codex 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요."
          : payload.error === "FREE_AI_DAILY_LIMIT" ? "무료 AI 일일 한도에 도달했습니다."
            : payload.error === "CODEX_LUNA_UNAVAILABLE" ? "현재 ChatGPT 계정에서는 GPT-5.6 Luna를 사용할 수 없습니다."
              : payload.error || "AI 제목 추천에 실패했습니다.";
        throw new Error(label);
      }
      setSuggestions(payload.suggestions ?? []);
      setMessage(`${payload.providerLabel ?? "AI"}가 서로 다른 방향의 제목 5개를 추천했습니다.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "AI 제목 추천에 실패했습니다.");
    } finally {
      setRecommending(false);
    }
  }

  async function saveTitle() {
    const next = draftTitle.trim();
    if (!next) {
      setError("제목을 입력해 주세요.");
      return;
    }
    if (next === title) {
      setMessage("현재 저장된 제목과 같습니다.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/books/${bookId}/title`, {
        method: "PATCH",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: next })
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "제목 저장에 실패했습니다.");
      setMessage("제목을 저장했습니다. 표지와 PDF에도 새 제목이 반영됩니다.");
      window.setTimeout(() => window.location.reload(), 450);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "제목 저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {devicePrompt ? <ChatGptDeviceCodePanel verificationUrl={devicePrompt.verificationUrl} userCode={devicePrompt.userCode} /> : null}
      {open ? (
        <section className={styles.drawer} aria-label="제목 스튜디오">
          <div className={styles.drawerHead}>
            <div><span>BOOK NAMING</span><strong>제목 스튜디오</strong></div>
            <button type="button" onClick={() => setOpen(false)}>닫기</button>
          </div>

          <div className={styles.field}>
            <label htmlFor={`book-title-${bookId}`}>직접 제목 정하기</label>
            <textarea
              id={`book-title-${bookId}`}
              value={draftTitle}
              maxLength={160}
              onChange={(event) => { setDraftTitle(event.target.value); setMessage(""); }}
              placeholder="책 제목을 직접 입력하세요."
            />
            <div className={styles.fieldMeta}><span>추천 제목을 선택한 뒤 자유롭게 수정할 수도 있습니다.</span><b>{draftTitle.trim().length}/160</b></div>
          </div>

          <div className={styles.actions}>
            <button type="button" className={styles.aiButton} disabled={recommending || saving} onClick={() => void recommendTitles()}>
              {recommending ? "AI가 제목을 설계하는 중…" : "AI 제목 5개 추천"}
            </button>
            <button type="button" className={styles.saveButton} disabled={saving || !draftTitle.trim()} onClick={() => void saveTitle()}>
              {saving ? "저장 중…" : "이 제목으로 저장"}
            </button>
          </div>

          {suggestions.length ? (
            <div className={styles.suggestions} aria-label="AI 추천 제목">
              <div className={styles.suggestionHead}><strong>추천 제목</strong><span>눌러서 적용 · 적용 후 수정 가능</span></div>
              {suggestions.map((suggestion, index) => {
                const selected = draftTitle.trim() === suggestion.title.trim();
                return (
                  <button
                    key={`${suggestion.title}-${index}`}
                    type="button"
                    className={`${styles.suggestion} ${selected ? styles.selected : ""}`}
                    onClick={() => { setDraftTitle(suggestion.title); setMessage(`“${suggestion.title}”을 선택했습니다. 저장 전 자유롭게 수정할 수 있습니다.`); }}
                  >
                    <span className={styles.index}>{String(index + 1).padStart(2, "0")}</span>
                    <div><small>{suggestion.angle}</small><strong>{suggestion.title}</strong><p>{suggestion.reason}</p></div>
                    <span className={styles.pick}>{selected ? "선택됨" : "선택"}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {message ? <p className={styles.message} aria-live="polite">{message}</p> : null}
          {error ? <p className={styles.error} role="alert">{error}</p> : null}
        </section>
      ) : null}

      <button type="button" className={styles.launcher} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className={styles.mark}>T</span>
        <span><small>BOOK NAMING</small><strong>제목 정하기</strong></span>
      </button>
    </>
  );
}
