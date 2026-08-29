"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { beginFreeAiConnect, clearFreeAiKey, getFreeAiKey } from "@/lib/ai/openrouter-browser";

const bookTypes = ["AI / 실용서","비즈니스 / 창업","교육용","기술서","미스터리 로맨스","SF 미스터리","에세이","아동용","매뉴얼 / 튜토리얼"];
const tones = ["친근한 교육형","전문적이지만 읽기 쉬운","차분하고 신뢰감 있는","따뜻하고 감성적인","강렬하고 설득력 있는","대화형","이야기형"];
const templates = [
  { id: "modern-editorial", name: "Modern Editorial", note: "넓은 여백 · 세리프 타이틀 · 절제된 강조" },
  { id: "minimal-tech", name: "Minimal Tech", note: "명확한 계층 · 표/코드 중심 · 정밀한 리듬" },
  { id: "quiet-fiction", name: "Quiet Fiction", note: "읽기 중심 · 낮은 시각 밀도 · 문학적 장 시작" }
];

type FormState = {
  idea: string; bookType: string; audience: string; ageGroup: string;
  knowledgeLevel: "beginner" | "intermediate" | "advanced" | "expert";
  tone: string; targetPages: number; templateMood: string; mode: "quick" | "advanced";
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
  const steps = ["아이디어","책 종류","독자","문체","분량","템플릿","검토"];

  useEffect(() => {
    const timer = setTimeout(() => setFreeConnected(Boolean(getFreeAiKey())), 0);
    return () => clearTimeout(timer);
  }, []);

  const pageEstimate = useMemo(() => {
    const wordsPerPage = form.bookType === "아동용" ? 90 : form.bookType.includes("소설") ? 285 : 310;
    return Math.round(form.targetPages * wordsPerPage).toLocaleString();
  }, [form.targetPages, form.bookType]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
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
      router.push(`/books/${payload.bookId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "생성 실패");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="wizard">
      <div className="eyebrow">Create a new book</div>
      <h1 style={{ fontSize: 48, marginTop: 8 }}>책의 방향부터 설계합니다.</h1>
      <div className="panel" style={{marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between",gap:16}}>
        <div><strong>{freeConnected ? "무료 AI 연결됨" : "무료 AI 연결 필요"}</strong><p className="muted" style={{margin:"4px 0 0"}}>OpenRouter 무료 모델만 사용합니다. AI 토큰 비용은 0원이며 무료 일일 한도에서 자동으로 이어쓰기 됩니다.</p></div>
        {freeConnected
          ? <button className="button secondary" onClick={disconnectFreeAi}>연결 해제</button>
          : <button className="button" onClick={connectFreeAi}>무료 AI 연결</button>}
      </div>
      <div className="stepbar" aria-label="wizard progress">
        {steps.map((_, index) => <span key={index} className={index <= step ? "active" : ""} />)}
      </div>

      <div className="panel">
        {step === 0 && <>
          <div className="eyebrow">Step 1 · Idea</div><h2>무슨 책을 만들고 싶나요?</h2>
          <p className="muted">한 문장만 써도 됩니다. 무료 AI가 독자와 구조를 구체화합니다.</p>
          <div className="field"><textarea value={form.idea} onChange={(e) => update("idea", e.target.value)} placeholder="예: 중학생이 읽을 수 있는 생성형 AI 입문서를 120페이지 정도로 친근하게 설명해줘." /></div>
          <div className="chips" style={{ marginTop: 14 }}>
            {["고등학생을 위한 ChatGPT 공부법","AI 시대 1인 창업 가이드","20대 여성을 위한 미스터리 로맨스"].map((idea) => <button key={idea} className="chip" onClick={() => update("idea", idea)}>{idea}</button>)}
          </div>
        </>}

        {step === 1 && <>
          <div className="eyebrow">Step 2 · Book type</div><h2>장르 엔진을 선택하세요.</h2>
          <p className="muted">장르마다 구조, 속도, 인용, 디자인 규칙이 달라집니다.</p>
          <div className="chips">{bookTypes.map((type) => <button key={type} className={`chip ${form.bookType === type ? "active" : ""}`} onClick={() => update("bookType", type)}>{type}</button>)}</div>
        </>}

        {step === 2 && <>
          <div className="eyebrow">Step 3 · Reader profile</div><h2>누가 읽게 될까요?</h2>
          <div className="form-grid" style={{ marginTop: 20 }}>
            <div className="field"><label>예상 독자</label><input value={form.audience} onChange={(e) => update("audience", e.target.value)} /></div>
            <div className="field"><label>독자 나이</label><input value={form.ageGroup} onChange={(e) => update("ageGroup", e.target.value)} /></div>
            <div className="field"><label>사전 지식 수준</label><select value={form.knowledgeLevel} onChange={(e) => update("knowledgeLevel", e.target.value as FormState["knowledgeLevel"])}><option value="beginner">입문</option><option value="intermediate">중급</option><option value="advanced">고급</option><option value="expert">전문가</option></select></div>
          </div>
        </>}

        {step === 3 && <>
          <div className="eyebrow">Step 4 · Voice & tone</div><h2>어떤 목소리로 쓸까요?</h2>
          <div className="chips" style={{ marginTop: 20 }}>{tones.map((tone) => <button key={tone} className={`chip ${form.tone === tone ? "active" : ""}`} onClick={() => update("tone", tone)}>{tone}</button>)}</div>
          <div className="field" style={{ marginTop: 16 }}><label>자연어 스타일도 가능</label><input value={form.tone} onChange={(e) => update("tone", e.target.value)} placeholder="예: 20대에게 친한 형이 설명하는 것처럼" /></div>
        </>}

        {step === 4 && <>
          <div className="eyebrow">Step 5 · Length</div><h2>목표 분량</h2>
          <div className="field" style={{ marginTop: 20 }}><label>목표 페이지 · {form.targetPages}p</label><input type="range" min="20" max="500" step="10" value={form.targetPages} onChange={(e) => update("targetPages", Number(e.target.value))} /></div>
          <p className="muted">장르별 페이지 밀도를 반영한 1차 추정: 약 {pageEstimate} 단어. 무료 한도가 끝나면 저장 후 다음 한도에서 자동 이어쓰기 할 수 있습니다.</p>
        </>}

        {step === 5 && <>
          <div className="eyebrow">Step 6 · Design DNA</div><h2>템플릿은 틀이 아니라 분위기입니다.</h2>
          <p className="muted">페이지마다 같은 구조를 복사하지 않고 선택한 Design DNA를 다양한 레이아웃에 적용합니다.</p>
          <div className="grid" style={{ marginTop: 20 }}>{templates.map((template) => <button key={template.id} className={`book-card ${form.templateMood === template.id ? "template-selected" : ""}`} onClick={() => update("templateMood", template.id)} style={{ textAlign: "left" }}><div className={`template-preview template-${template.id}`}><span>CHAPTER 01</span><strong>Design<br/>DNA</strong><small>Body · Quote · Data</small></div><strong>{template.name}</strong><p className="muted" style={{ fontSize: 12 }}>{template.note}</p></button>)}</div>
        </>}

        {step === 6 && <>
          <div className="eyebrow">Step 7 · Free AI planning</div><h2>이 설정으로 Book Blueprint를 생성합니다.</h2>
          <div className="review-list">
            <p><b>아이디어</b><span>{form.idea}</span></p><p><b>종류</b><span>{form.bookType}</span></p><p><b>독자</b><span>{form.ageGroup} · {form.knowledgeLevel}</span></p><p><b>문체</b><span>{form.tone}</span></p><p><b>분량</b><span>{form.targetPages} pages</span></p><p><b>Design DNA</b><span>{form.templateMood}</span></p>
          </div>
          <p className="muted">무료 모델은 실시간 웹 리서치 없이 집필합니다. 사실·통계·출처가 중요한 책은 완성 후 출처 검토가 필요합니다.</p>
        </>}

        {error && <p className="notice">{error}</p>}
        <div className="actions" style={{ justifyContent: "space-between" }}>
          <button className="button secondary" disabled={step === 0 || loading} onClick={() => setStep((s) => Math.max(0, s - 1))}>이전</button>
          {step < steps.length - 1 ? <button className="button" disabled={step === 0 && form.idea.trim().length < 8} onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}>다음</button> : <button className="button" disabled={loading || form.idea.trim().length < 8} onClick={createBook}>{loading ? "무료 AI가 기획 중…" : freeConnected ? "무료 AI로 기획 생성" : "무료 AI 연결하고 기획 생성"}</button>}
        </div>
      </div>
    </section>
  );
}
