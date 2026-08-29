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

const BOOK_WIZARD_DRAFT_KEY = "ai-book-studio:book-wizard-draft:v1";

const planningCheckpoints = [
  { title: "프로젝트 저장", note: "입력 설정을 먼저 안전하게 저장" },
  { title: "작업 등록", note: "Vercel Workflow에 백그라운드 작업 생성" },
  { title: "작업실 열기", note: "화면을 나가도 작업은 계속 진행" },
  { title: "AI 기획 진행", note: "Book Blueprint · 전체 목차를 서버에서 생성" }
] as const;

type FormState = {
  idea: string;
  bookType: string;
  audience: string;
  ageGroup: string;
  knowledgeLevel: "beginner" | "intermediate" | "advanced" | "expert";
  tone: string;
  targetPages: number;
  templateMood: string;
  mode: "quick" | "advanced";
};

type PlanningPhase = "prepare" | "waiting" | "saving" | "done" | "error";
type PlanningProgress = {
  percent: number;
  phase: PlanningPhase;
  label: string;
  detail: string;
  elapsedSeconds: number;
};

type WizardDraft = {
  form?: Partial<FormState>;
  step?: number;
  updatedAt?: number;
};

const initial: FormState = {
  idea: "",
  bookType: "AI / 실용서",
  audience: "처음 이 주제를 배우는 독자",
  ageGroup: "중학생",
  knowledgeLevel: "beginner",
  tone: "친근한 교육형",
  targetPages: 120,
  templateMood: "modern-editorial",
  mode: "quick"
};

function clampStep(value: number) {
  return Math.min(6, Math.max(0, Number.isFinite(value) ? Math.trunc(value) : 0));
}

function restoreDraft(raw: string | null): { form: FormState; step: number } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WizardDraft;
    if (!parsed || typeof parsed !== "object" || !parsed.form || typeof parsed.form !== "object") return null;
    const merged = { ...initial, ...parsed.form } as FormState;
    if (!(["beginner", "intermediate", "advanced", "expert"] as const).includes(merged.knowledgeLevel)) merged.knowledgeLevel = initial.knowledgeLevel;
    if (!(["quick", "advanced"] as const).includes(merged.mode)) merged.mode = initial.mode;
    merged.targetPages = Number.isFinite(Number(merged.targetPages)) ? Math.min(500, Math.max(20, Number(merged.targetPages))) : initial.targetPages;
    return { form: merged, step: clampStep(Number(parsed.step ?? 0)) };
  } catch {
    return null;
  }
}

function checkpointClass(phase: PlanningPhase, index: number) {
  if (phase === "error") return "";
  const activeIndex = phase === "prepare" ? 0 : phase === "saving" ? 1 : phase === "waiting" ? 2 : 3;
  if (index < activeIndex) return "complete";
  if (index === activeIndex) return phase === "done" ? "complete current" : "current";
  return "";
}

function PlanningProgressPanel({ progress }: { progress: PlanningProgress }) {
  const header = progress.phase === "done" ? "등록 완료" : progress.phase === "error" ? "중단" : "백그라운드 생성 준비";

  return (
    <section className={`planning-progress planning-${progress.phase}`} aria-live="polite" aria-label="Book Blueprint 백그라운드 작업 등록 상황">
      <div className="planning-progress-head">
        <div>
          <span>{header}</span>
          <strong>{progress.label}</strong>
        </div>
        <b>{Math.round(progress.percent)}%</b>
      </div>

      <div className="planning-progress-track" aria-hidden="true">
        <span style={{ width: `${progress.percent}%` }} />
      </div>

      <div className="planning-progress-meta">
        <p>{progress.detail}</p>
      </div>

      <ol className="planning-checkpoints">
        {planningCheckpoints.map((item, index) => (
          <li key={item.title} className={checkpointClass(progress.phase, index)}>
            <span>{index + 1}</span>
            <div>
              <strong>{item.title}</strong>
              <small>{item.note}</small>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function BookWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [freeConnected, setFreeConnected] = useState(false);
  const [planningProgress, setPlanningProgress] = useState<PlanningProgress | null>(null);
  const [draftRestored, setDraftRestored] = useState(false);
  const steps = ["아이디어","책 종류","독자","문체","분량","디자인","검토"];

  useEffect(() => {
    const timer = setTimeout(() => {
      const localConnected = Boolean(getFreeAiKey());
      setFreeConnected(localConnected);
      void fetch("/api/auth/openrouter/connection", { cache: "no-store" })
        .then((response) => response.json().then((payload) => ({ response, payload })))
        .then(({ response, payload }) => {
          if (response.ok && payload.connected === true) setFreeConnected(true);
        })
        .catch(() => undefined);

      const draft = restoreDraft(localStorage.getItem(BOOK_WIZARD_DRAFT_KEY));
      if (draft) {
        setForm(draft.form);
        setStep(draft.step);
        setDraftRestored(true);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const pageEstimate = useMemo(() => {
    const wordsPerPage = form.bookType === "아동용" ? 90 : form.bookType.includes("소설") ? 285 : 310;
    return Math.round(form.targetPages * wordsPerPage).toLocaleString();
  }, [form.targetPages, form.bookType]);

  function persistDraft(nextForm: FormState, nextStep: number) {
    try {
      localStorage.setItem(BOOK_WIZARD_DRAFT_KEY, JSON.stringify({ form: nextForm, step: clampStep(nextStep), updatedAt: Date.now() } satisfies WizardDraft));
    } catch {
      // Browser storage can be unavailable in private/restricted contexts; the UI should keep working.
    }
  }

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    if (!loading && planningProgress?.phase === "error") setPlanningProgress(null);
    setForm((previous) => {
      const next = { ...previous, [key]: value };
      persistDraft(next, step);
      return next;
    });
    setDraftRestored(false);
  }

  function goToStep(nextStep: number) {
    const next = clampStep(nextStep);
    setStep(next);
    persistDraft(form, next);
  }

  async function connectFreeAi() {
    setError("");
    persistDraft(form, step);
    await beginFreeAiConnect("/books/new");
  }

  async function disconnectFreeAi() {
    clearFreeAiKey();
    setFreeConnected(false);
    try { await fetch("/api/auth/openrouter/connection", { method: "DELETE" }); }
    catch { /* browser session is still disconnected */ }
  }

  async function createBook() {
    if (!freeConnected && !getFreeAiKey()) {
      await connectFreeAi();
      return;
    }

    persistDraft(form, step);
    setLoading(true);
    setError("");
    setPlanningProgress({
      percent: 20,
      phase: "prepare",
      label: "프로젝트를 저장하는 중",
      detail: "입력한 독자, 문체, 분량, 디자인 설정을 먼저 서버에 안전하게 저장합니다.",
      elapsedSeconds: 0
    });

    try {
      const key = getFreeAiKey();
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (key) headers["x-openrouter-key"] = key;

      setPlanningProgress({
        percent: 45,
        phase: "saving",
        label: "백그라운드 작업을 등록하는 중",
        detail: "프로젝트를 만든 뒤 Vercel Workflow에 Book Blueprint 생성을 등록합니다.",
        elapsedSeconds: 0
      });

      const response = await fetch("/api/books", {
        method: "POST",
        headers,
        body: JSON.stringify(form)
      });
      const payload = await response.json();
      if (response.status === 428 || payload.reconnect) {
        await connectFreeAi();
        return;
      }
      if (!response.ok) throw new Error(payload.error ?? "책 프로젝트 생성에 실패했습니다.");
      if (!payload.bookId) throw new Error("생성된 책 프로젝트 ID를 받지 못했습니다.");

      setPlanningProgress({
        percent: 85,
        phase: "waiting",
        label: "백그라운드 작업 등록 완료",
        detail: "이제 화면을 나가거나 브라우저를 닫아도 서버가 Book Blueprint와 전체 목차 생성을 계속합니다.",
        elapsedSeconds: 0
      });

      try { localStorage.removeItem(BOOK_WIZARD_DRAFT_KEY); } catch { /* no-op */ }
      setDraftRestored(false);

      setPlanningProgress({
        percent: 100,
        phase: "done",
        label: "작업실에서 계속 확인할 수 있습니다",
        detail: "작업실을 여는 중입니다. 기획 진행률과 현재 상태는 서버에서 다시 불러옵니다.",
        elapsedSeconds: 0
      });

      await new Promise((resolve) => setTimeout(resolve, 220));
      router.push(`/books/${payload.bookId}`);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "생성 실패";
      setError(message);
      persistDraft(form, step);
      setPlanningProgress((previous) => ({
        percent: previous?.percent ?? 0,
        phase: "error",
        label: "프로젝트 작업을 등록하지 못했습니다",
        detail: "입력한 설정은 기기에 임시저장되어 있으므로 다시 시도해도 사라지지 않습니다.",
        elapsedSeconds: 0
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
    "프로젝트를 저장하고 백그라운드 생성을 시작합니다."
  ][step];

  return (
    <section className="wizard-shell">
      <aside className="wizard-rail">
        <div className="wizard-rail-head"><span>BOOK BLUEPRINT</span><strong>새 원고 설계</strong></div>
        <ol className="wizard-steps">
          {steps.map((label, index) => (
            <li key={label} className={index === step ? "current" : index < step ? "done" : ""}>
              <span>{String(index + 1).padStart(2, "0")}</span><strong>{label}</strong>
            </li>
          ))}
        </ol>
        <div className={`free-ai-rail ${freeConnected ? "connected" : ""}`}>
          <span className="status-dot" aria-hidden="true" />
          <div><strong>{freeConnected ? "무료 AI 백그라운드 연결됨" : "무료 AI 연결 필요"}</strong><small>OpenRouter · 서버 Vault</small></div>
        </div>
      </aside>

      <div className="wizard-stage">
        <header className="wizard-header">
          <div><span className="step-count">{step + 1} / {steps.length}</span><h1>{stepTitle}</h1></div>
          {freeConnected
            ? <button className="button secondary compact" disabled={loading} onClick={disconnectFreeAi}>AI 연결 해제</button>
            : <button className="button button-primary compact" disabled={loading} onClick={connectFreeAi}>무료 AI 연결</button>}
        </header>

        <div className="wizard-workspace">
          {step === 0 && (
            <div className="wizard-section">
              <p className="wizard-lead">한 문장만 적어도 됩니다. 여기서 입력한 의도를 바탕으로 제목, 독자, 목차와 분량을 확장합니다.</p>
              <div className="idea-field">
                <textarea aria-label="책 아이디어" value={form.idea} onChange={(event) => update("idea", event.target.value)} placeholder="예: 중학생이 생성형 AI를 처음 이해할 수 있도록 사례 중심의 입문서를 만들어줘." />
                <span>{form.idea.trim().length} chars</span>
              </div>
              <div className="prompt-suggestions">
                <span>바로 시작하기</span>
                <div>{["고등학생을 위한 ChatGPT 공부법","AI 시대 1인 창업 가이드","20대 여성을 위한 미스터리 로맨스"].map((idea) => <button key={idea} onClick={() => update("idea", idea)}>{idea}</button>)}</div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="wizard-section">
              <p className="wizard-lead">장르 선택은 목차 구조, 정보 밀도, 예시의 방식과 문장 호흡을 결정합니다.</p>
              <div className="choice-grid">{bookTypes.map((type) => <button key={type} className={`choice-tile ${form.bookType === type ? "active" : ""}`} onClick={() => update("bookType", type)}><strong>{type}</strong><span>{form.bookType === type ? "선택됨" : "선택"}</span></button>)}</div>
            </div>
          )}

          {step === 2 && (
            <div className="wizard-section">
              <p className="wizard-lead">같은 주제라도 독자가 달라지면 설명 순서와 단어 선택이 달라집니다.</p>
              <div className="form-grid two-column">
                <div className="field field-wide"><label>예상 독자</label><input value={form.audience} onChange={(event) => update("audience", event.target.value)} /></div>
                <div className="field"><label>독자 나이</label><input value={form.ageGroup} onChange={(event) => update("ageGroup", event.target.value)} /></div>
                <div className="field"><label>사전 지식 수준</label><select value={form.knowledgeLevel} onChange={(event) => update("knowledgeLevel", event.target.value as FormState["knowledgeLevel"])}><option value="beginner">입문</option><option value="intermediate">중급</option><option value="advanced">고급</option><option value="expert">전문가</option></select></div>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="wizard-section">
              <p className="wizard-lead">문체는 책 전체에 유지되는 규칙입니다. 프리셋을 고르거나 직접 설명할 수 있습니다.</p>
              <div className="choice-grid tone-grid">{tones.map((tone) => <button key={tone} className={`choice-tile ${form.tone === tone ? "active" : ""}`} onClick={() => update("tone", tone)}><strong>{tone}</strong></button>)}</div>
              <div className="field custom-tone"><label>직접 문체 설명</label><input value={form.tone} onChange={(event) => update("tone", event.target.value)} placeholder="예: 20대에게 친한 선배가 설명하는 것처럼" /></div>
            </div>
          )}

          {step === 4 && (
            <div className="wizard-section length-section">
              <div className="length-number"><strong>{form.targetPages}</strong><span>pages</span></div>
              <div className="field range-field"><label>목표 분량</label><input type="range" min="20" max="500" step="10" value={form.targetPages} onChange={(event) => update("targetPages", Number(event.target.value))} /></div>
              <div className="length-scale"><span>20p · 짧은 가이드</span><span>500p · 장편</span></div>
              <p className="wizard-lead">현재 장르 기준 약 <strong>{pageEstimate}단어</strong>를 목표로 잡습니다. 무료 한도에 도달하면 저장한 위치에서 Workflow가 대기 후 자동 재개합니다.</p>
            </div>
          )}

          {step === 5 && (
            <div className="wizard-section">
              <p className="wizard-lead">템플릿을 복제하지 않고 선택한 Design DNA만 페이지 조판에 반영합니다.</p>
              <div className="template-grid">
                {templates.map((template) => (
                  <button key={template.id} className={`template-choice ${form.templateMood === template.id ? "active" : ""}`} onClick={() => update("templateMood", template.id)}>
                    <div className={`template-preview template-${template.id}`}><span>CHAPTER</span><strong>Design<br />DNA</strong><small>Body / Quote / Data</small></div>
                    <div><strong>{template.name}</strong><p>{template.note}</p></div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="wizard-section review-section">
              <p className="wizard-lead">먼저 프로젝트를 저장한 뒤, 무료 AI가 Book Blueprint와 전체 목차를 백그라운드에서 설계합니다. 작업실을 나가도 계속됩니다.</p>
              <div className="review-list">
                <p><b>아이디어</b><span>{form.idea}</span></p>
                <p><b>책 종류</b><span>{form.bookType}</span></p>
                <p><b>독자</b><span>{form.ageGroup} · {form.knowledgeLevel} · {form.audience}</span></p>
                <p><b>문체</b><span>{form.tone}</span></p>
                <p><b>분량</b><span>{form.targetPages} pages · 약 {pageEstimate}단어</span></p>
                <p><b>Design DNA</b><span>{templates.find((item) => item.id === form.templateMood)?.name ?? form.templateMood}</span></p>
              </div>
              <div className="research-note"><strong>백그라운드 무료 모드</strong><p>프로젝트와 진행률은 서버에 저장됩니다. 브라우저를 닫아도 Workflow가 계속되며, 무료 한도에 도달하면 저장된 위치에서 대기 후 자동으로 이어갑니다. 실시간 웹 리서치는 하지 않습니다.</p></div>
            </div>
          )}

          {planningProgress && <PlanningProgressPanel progress={planningProgress} />}
          {error && <p className="notice" role="alert">{error}</p>}

          <footer className="wizard-actions">
            <div style={{ marginRight: "auto", alignSelf: "center" }} className="muted" aria-live="polite">
              <small>{draftRestored ? "이전에 입력한 임시저장을 복원했습니다." : "작업 등록 전 입력 내용은 이 기기에 자동 임시저장됩니다."}</small>
            </div>
            <button className="button secondary" disabled={step === 0 || loading} onClick={() => goToStep(step - 1)}>이전</button>
            {step < steps.length - 1 ? (
              <button className="button button-primary" disabled={loading || (step === 0 && form.idea.trim().length < 8)} onClick={() => goToStep(step + 1)}>다음 단계</button>
            ) : (
              <button className="button button-primary" disabled={loading || form.idea.trim().length < 8} onClick={createBook}>
                {loading ? "프로젝트 저장 · 작업 등록 중…" : freeConnected ? "Book Blueprint 백그라운드 생성" : "무료 AI 연결 후 생성"}
              </button>
            )}
          </footer>
        </div>
      </div>
    </section>
  );
}
