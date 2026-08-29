"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { beginFreeAiConnect, clearFreeAiKey, getFreeAiKey } from "@/lib/ai/openrouter-browser";

const bookTypes = ["AI / 실용서","비즈니스 / 창업","교육용","기술서","미스터리 로맨스","SF 미스터리","에세이","아동용","매뉴얼 / 튜토리얼"];
const tones = ["친근한 교육형","전문적이지만 읽기 쉬운","차분하고 신뢰감 있는","따뜻하고 감성적인","강렬하고 설득력 있는","대화형","이야기형"];
const templates = [
  { id: "modern-editorial", name: "Modern Editorial", note: "넓은 여백 · 선명한 장 구분 · 절제된 강조" },
  { id: "minimal-tech", name: "Minimal Tech", note: "명확한 계층 · 표/코드 중심 · 정밀한 리듬" },
  { id: "quiet-fiction", name: "Quiet Fiction", note: "읽기 중심 · 낮은 시각 밀도 · 장면 중심 흐름" }
];

type FormState = {
  idea: string; bookType: string; audience: string; ageGroup: string;
  knowledgeLevel: "beginner" | "intermediate" | "advanced" | "expert";
  tone: string; targetPages: number; templateMood: string; mode: "quick" | "advanced";
};

type PlanningPhase = "prepare" | "waiting" | "saving" | "done" | "error";
type PlanningProgress = {
  percent: number;
  phase: PlanningPhase;
  label: string;
  detail: string;
  elapsedSeconds: number;
};

const initial: FormState = {
  idea: "", bookType: "AI / 실용서", audience: "처음 이 주제를 배우는 독자", ageGroup: "중학생",
  knowledgeLevel: "beginner", tone: "친근한 교육형", targetPages: 120,
  templateMood: "modern-editorial", mode: "quick"
};

export function BookWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [freeConnected, setFreeConnected] = useState(false);
  const [planningProgress, setPlanningProgress] = useState<PlanningProgress | null>(null);
  const steps = ["아이디어","책 종류","독자","문체","분량","디자인","검토"];

  useEffect(() => {
    const timer = setTimeout(() => setFreeConnected(Boolean(getFreeAiKey())), 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!loading) return;
    const startedAt = Date.now();
    const tick = () => {
      const elapsedSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
      const estimatedPercent = Math.min(88, Math.round(18 + Math.sqrt(Math.max(1, elapsedSeconds)) * 14));
      setPlanningProgress((previous) => {
        if (previous && ["saving", "done", "error"].includes(previous.phase)) return previous;
        return {
          percent: estimatedPercent,
          phase: "waiting",
          label: "무료 AI 응답을 기다리는 중",
          detail: "Book Blueprint와 전체 목차를 생성하고 있습니다. 이 구간의 퍼센트는 예상 진행률입니다.",
          elapsedSeconds
        };
      });
    };
    const firstTick = setTimeout(tick, 450);
    const timer = setInterval(tick, 900);
    return () => {
      clearTimeout(firstTick);
      clearInterval(timer);
    };
  }, [loading]);

  const pageEstimate = useMemo(() => {
    const wordsPerPage = form.bookType === "아동용" ? 90 : form.bookType.includes("소설") ? 285 : 310;
    return Math.round(form.targetPages * wordsPerPage).toLocaleString();
  }, [form.targetPages, form.bookType]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    updatePlanningReset();
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updatePlanningReset() {
    if (!loading && planningProgress?.phase === "error") setPlanningProgress(null);
  }

  async function connectFreeAi() {
    setError("");
    await beginFreeAiConnect("/books/new");
  }

  function disconnectFreeAi() {
    clearFreeAiKey();
    setFreeConnected(false);
  }

  async function createBook() {
    const key = getFreeAiKey();
    if (!key) {
      await connectFreeAi();
      return;
    }
    setLoading(true);
    setError("");
    setPlanningProgress({
      percent: 8,
      phase: "prepare",
      label: "기획 요청 준비",
      detail: "선택한 독자, 문체, 분량, 디자인 설정을 무료 AI에 전달합니다.",
      elapsedSeconds: 0
    });
    try {
      const response = await fetch("/api/books", {
        method: "POST",
        headers: { "content-type": "application/json", "x-openrouter-key": key },
        body: JSON.stringify(form)
      });
      const payload = await response.json();
      if (!response.ok) {
        if (payload.error === "FREE_AI_DAILY_LIMIT") throw new Error("오늘 무료 AI 사용 한도에 도달했습니다. 다음 무료 한도에서 다시 시도할 수 있습니다.");
        throw new Error(payload.error ?? "책 기획 생성에 실패했습니다.");
      }

      setPlanningProgress((previous) => ({
        percent: 96,
        phase: "saving",
        label: "기획안 생성 완료 · 프로젝트 저장 확인",
        detail: "AI 응답을 받았습니다. 생성된 Book Blueprint와 목차를 작업실에 연결하고 있습니다.",
        elapsedSeconds: previous?.elapsedSeconds ?? 0
      }));

      await new Promise((resolve) => setTimeout(resolve, 280));
      setPlanningProgress((previous) => ({
        percent: 100,
        phase: "done",
        label: "Book Blueprint 생성 완료",
        detail: "책 작업실을 여는 중입니다.",
        elapsedSeconds: previous?.elapsedSeconds ?? 0
      }));
      await new Promise((resolve) => setTimeout(resolve, 320));
      router.push(`/books/${payload.bookId}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "생성 실패";
      setError(message);
      setPlanningProgress((previous) => ({
        percent: previous?.percent ?? 0,
        phase: "error",
        label: "기획 생성을 완료하지 못했습니다",
        detail: "아래 오류 내용을 확인한 뒤 다시 시도할 수 있습니다.",
        elapsedSeconds: previous?.elapsedSeconds ?? 0
      }));
    } finally {
      setLoading(false);
    }
  }

  const stepTitle = [
    "무슨 책을 만들고 싶나요?",
    "책이 어떤 방식으로 읽혀야 하나요?",
    "누가 이 책을 읽게 될까요?",
    "어떤 목소리로 설명할까요?",
    "얼마나 깊게 다룰까요?",
    "페이지의 분위기를 정합니다.",
    "이제 AI가 책의 뼈대를 만듭니다."
  ][step];

  return (
    <section className="wizard-shell">
      <aside className="wizard-rail">
        <div className="wizard-rail-head">
          <span>BOOK BLUEPRINT</span>
          <strong>새 원고 설계</strong>
        </div>
        <ol className="wizard-steps">
          {steps.map((label, index) => (
            <li key={label} className={index === step ? "current" : index < step ? "done" : ""}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{label}</strong>
            </li>
          ))}
        </ol>
        <div className={`free-ai-rail ${freeConnected ? "connected" : ""}`}>
          <span className="status-dot" aria-hidden="true" />
          <div>
            <strong>{freeConnected ? "무료 AI 연결됨" : "무료 AI 연결 필요"}</strong>
            <small>OpenRouter 무료 모델</small>
          </div>
        </div>
      </aside>

      <div className="wizard-stage">
        <header className="wizard-header">
          <div>
            <span className="step-count">{step + 1} / {steps.length}</span>
            <h1>{stepTitle}</h1>
          </div>
          {freeConnected
            ? <button className="button secondary compact" disabled={loading} onClick={disconnectFreeAi}>AI 연결 해제</button>
            : <button className="button button-primary compact" disabled={loading} onClick={connectFreeAi}>무료 AI 연결</button>}
        </header>

        <div className="wizard-workspace">
          {step === 0 && <div className="wizard-section">
            <p className="wizard-lead">한 문장만 적어도 됩니다. 여기서 입력한 의도를 바탕으로 제목, 독자, 목차와 분량을 확장합니다.</p>
            <div className="idea-field">
              <textarea aria-label="책 아이디어" value={form.idea} onChange={(e) => update("idea", e.target.value)} placeholder="예: 중학생이 생성형 AI를 처음 이해할 수 있도록 사례 중심의 입문서를 만들어줘." />
              <span>{form.idea.trim().length} chars</span>
            </div>
            <div className="prompt-suggestions">
              <span>바로 시작하기</span>
              <div>{["고등학생을 위한 ChatGPT 공부법","AI 시대 1인 창업 가이드","20대 여성을 위한 미스터리 로맨스"].map((idea) => <button key={idea} onClick={() => update("idea", idea)}>{idea}</button>)}</div>
            </div>
          </div>}

          {step === 1 && <div className="wizard-section">
            <p className="wizard-lead">장르 선택은 목차 구조, 정보 밀도, 예시의 방식과 문장 호흡을 결정합니다.</p>
            <div className="choice-grid">{bookTypes.map((type) => <button key={type} className={`choice-tile ${form.bookType === type ? "active" : ""}`} onClick={() => update("bookType", type)}><strong>{type}</strong><span>{form.bookType === type ? "선택됨" : "선택"}</span></button>)}</div>
          </div>}

          {step === 2 && <div className="wizard-section">
            <p className="wizard-lead">같은 주제라도 독자가 달라지면 설명 순서와 단어 선택이 달라집니다.</p>
            <div className="form-grid two-column">
              <div className="field field-wide"><label>예상 독자</label><input value={form.audience} onChange={(e) => update("audience", e.target.value)} /></div>
              <div className="field"><label>독자 나이</label><input value={form.ageGroup} onChange={(e) => update("ageGroup", e.target.value)} /></div>
              <div className="field"><label>사전 지식 수준</label><select value={form.knowledgeLevel} onChange={(e) => update("knowledgeLevel", e.target.value as FormState["knowledgeLevel"])}><option value="beginner">입문</option><option value="intermediate">중급</option><option value="advanced">고급</option><option value="expert">전문가</option></select></div>
            </div>
          </div>}

          {step === 3 && <div className="wizard-section">
            <p className="wizard-lead">문체는 책 전체에 유지되는 규칙입니다. 프리셋을 고르거나 직접 설명할 수 있습니다.</p>
            <div className="choice-grid tone-grid">{tones.map((tone) => <button key={tone} className={`choice-tile ${form.tone === tone ? "active" : ""}`} onClick={() => update("tone", tone)}><strong>{tone}</strong></button>)}</div>
            <div className="field custom-tone"><label>직접 문체 설명</label><input value={form.tone} onChange={(e) => update("tone", e.target.value)} placeholder="예: 20대에게 친한 선배가 설명하는 것처럼" /></div>
          </div>}

          {step === 4 && <div className="wizard-section length-section">
            <div className="length-number"><strong>{form.targetPages}</strong><span>pages</span></div>
            <div className="field range-field"><label>목표 분량</label><input type="range" min="20" max="500" step="10" value={form.targetPages} onChange={(e) => update("targetPages", Number(e.target.value))} /></div>
            <div className="length-scale"><span>20p · 짧은 가이드</span><span>500p · 장편</span></div>
            <p className="wizard-lead">현재 장르 기준 약 <strong>{pageEstimate}단어</strong>를 목표로 잡습니다. 무료 한도에 도달하면 저장한 위치에서 이어서 생성할 수 있습니다.</p>
          </div>}

          {step === 5 && <div className="wizard-section">
            <p className="wizard-lead">템플릿을 복제하지 않고 선택한 Design DNA만 페이지 조판에 반영합니다.</p>
            <div className="template-grid">{templates.map((template) => <button key={template.id} className={`template-choice ${form.templateMood === template.id ? "active" : ""}`} onClick={() => update("templateMood", template.id)}><div className={`template-preview template-${template.id}`}><span>CHAPTER</span><strong>Design<br/>DNA</strong><small>Body / Quote / Data</small></div><div><strong>{template.name}</strong><p>{template.note}</p></div></button>)}</div>
          </div>}

          {step === 6 && <div className="wizard-section review-section">
            <p className="wizard-lead">아래 설정으로 무료 AI가 Book Blueprint와 전체 목차를 먼저 설계합니다.</p>
            <div className="review-list">
              <p><b>아이디어</b><span>{form.idea}</span></p>
              <p><b>책 종류</b><span>{form.bookType}</span></p>
              <p><b>독자</b><span>{form.ageGroup} · {form.knowledgeLevel} · {form.audience}</span></p>
              <p><b>문체</b><span>{form.tone}</span></p>
              <p><b>분량</b><span>{form.targetPages} pages · 약 {pageEstimate}단어</span></p>
              <p><b>Design DNA</b><span>{templates.find((item) => item.id === form.templateMood)?.name ?? form.templateMood}</span></p>
            </div>
            <div className="research-note"><strong>무료 모드 안내</strong><p>실시간 웹 리서치는 하지 않습니다. 최신 통계나 출처가 중요한 책은 완성 후 별도 사실 검토가 필요합니다.</p></div>
          </div>}

          {planningProgress && (
            <section className={`planning-progress planning-${planningProgress.phase}`} aria-live="polite" aria-label="Book Blueprint 생성 진행 상황">
              <div className="planning-progress-head">
                <div>
                  <span>{planningProgress.phase === "done" ? "완료" : planningProgress.phase === "error" ? "중단" : "Book Blueprint 생성 중"}</span>
                  <strong>{planningProgress.label}</strong>
                </div>
                <b>{Math.round(planningProgress.percent)}%</b>
              </div>
              <div className="planning-progress-track" aria-hidden="true"><span style={{ width: `${planningProgress.percent}%` }} /></div>
              <div className="planning-progress-meta">
                <p>{planningProgress.detail}</p>
                {planningProgress.phase === "waiting" && <small>경과 {planningProgress.elapsedSeconds}초 · 예상 진행률</small>}
              </div>
              <ol className="planning-checkpoints">
                <li className={["prepare","waiting","saving","done"].includes(planningProgress.phase) ? "complete" : ""><span>1</span><div><strong>설정 전달</strong><small>독자 · 문체 · 분량 · 디자인</small></div></li>
                <li className={["waiting","saving","done"].includes(planningProgress.phase) ? (planningProgress.phase === "waiting" ? "current" : "complete") : ""><span>2</span><div><strong>무료 AI 응답</strong><small>Book Blueprint · 전체 목차</small></div></li>
                <li className={["saving","done"].includes(planningProgress.phase) ? (planningProgress.phase === "saving" ? "current" : "complete") : ""><span>3</span><div><strong>프로젝트 저장</strong><small>생성 결과를 작업실에 연결</small></div></li>
                <li className={planningProgress.phase === "done" ? "complete current" : ""><span>4</span><div><strong>작업실 열기</strong><small>원고 집필 화면으로 이동</small></div></li>
              </ol>
            </section>
          )}

          {error && <p className="notice" role="alert">{error}</p>}

          <footer className="wizard-actions">
            <button className="button secondary" disabled={step === 0 || loading} onClick={() => setStep((s) => Math.max(0, s - 1))}>이전</button>
            {step < steps.length - 1
              ? <button className="button button-primary" disabled={loading || (step === 0 && form.idea.trim().length < 8)} onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}>다음 단계</button>
              : <button className="button button-primary" disabled={loading || form.idea.trim().length < 8} onClick={createBook}>{loading ? `${Math.round(planningProgress?.percent ?? 0)}% · 기획 생성 중` : freeConnected ? "Book Blueprint 생성" : "무료 AI 연결 후 생성"}</button>}
          </footer>
        </div>
      </div>
    </section>
  );
}
