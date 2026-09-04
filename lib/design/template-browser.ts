export type TemplatePagePreview = {
  id: string;
  type: "cover" | "toc" | "chapter" | "body" | "quote" | "data" | "checklist" | "closing";
  kicker?: string;
  title: string;
  subtitle?: string;
  body?: string[];
  items?: string[];
  table?: Array<[string, string]>;
};

export type TemplateCard = {
  id: string;
  name: string;
  note: string;
  description: string;
  useCases: string[];
  sampleBookTitle: string;
  samplePages: TemplatePagePreview[];
  isSystem: boolean;
  baseTemplateId: string;
  accentColor?: string;
  paperTone?: string;
  headingFamily?: "serif" | "sans";
  bodyFamily?: "serif" | "sans";
  spacingScale?: "tight" | "balanced" | "airy";
  contentWidth?: "narrow" | "medium" | "wide";
  chapterStyle?: "classic" | "bold" | "minimal";
  quoteStyle?: "line" | "box" | "indent";
};

const sampleSets: Record<string, Omit<TemplateCard, "id" | "name" | "note" | "description" | "useCases" | "isSystem" | "baseTemplateId">> = {
  "modern-editorial": {
    sampleBookTitle: "생성형 AI를 이해하는 가장 쉬운 방법",
    samplePages: [
      { id: "cover", type: "cover", kicker: "AI BOOK STUDIO SAMPLE", title: "생성형 AI를\n이해하는 가장\n쉬운 방법", subtitle: "중학생도 끝까지 읽을 수 있는 입문 가이드" },
      { id: "toc", type: "toc", kicker: "Contents", title: "목차", items: ["01 생성형 AI가 무엇인지 이해하기", "02 ChatGPT는 어떻게 답할까", "03 공부와 생활에서 활용하는 법", "04 안전하게 사용하는 습관"] },
      { id: "chapter", type: "chapter", kicker: "Chapter 01", title: "AI를\n처음 만나는\n순간", subtitle: "낯선 개념을 실생활 예시로 먼저 연결합니다." },
      { id: "body", type: "body", kicker: "Body", title: "설명 페이지", body: ["생성형 AI는 질문을 받으면 학습한 패턴을 바탕으로 새로운 문장을 만들어냅니다.", "사람이 질문을 어떻게 던지느냐에 따라 답의 품질이 크게 달라집니다."] },
      { id: "quote", type: "quote", kicker: "Quote", title: "좋은 질문은\n좋은 답을\n불러온다.", subtitle: "— 프롬프트의 기본 원리" },
      { id: "data", type: "data", kicker: "Key Data", title: "핵심 비교", table: [["정의", "질문에 맞는 새 문장 생성"], ["장점", "빠른 요약 · 다양한 예시"], ["주의", "사실 검증 필요"]] },
      { id: "closing", type: "closing", kicker: "Closing", title: "다음 장에서는\n실전 활용으로\n들어갑니다." }
    ]
  },
  "minimal-tech": {
    sampleBookTitle: "프롬프트 엔지니어링 스타터",
    samplePages: [
      { id: "cover", type: "cover", kicker: "GUIDEBOOK / SAMPLE", title: "프롬프트\n엔지니어링\n스타터", subtitle: "실전 예제로 익히는 AI 대화 설계" },
      { id: "toc", type: "toc", kicker: "Map", title: "구성", items: ["1. 입력을 구조화하는 법", "2. 역할 지정과 제약 조건", "3. 예시를 통한 출력 통제", "4. 결과 점검 체크리스트"] },
      { id: "chapter", type: "chapter", kicker: "Chapter 01", title: "입력을\n구조로\n바꾸기", subtitle: "Objective · AI가 헷갈리지 않도록 요청을 분해한다." },
      { id: "body", type: "body", kicker: "Explainer", title: "설명", body: ["좋은 프롬프트는 목적, 대상, 제약, 출력 형식을 분명하게 지정합니다.", "예시 입력과 예시 출력을 함께 주면 원하는 형식을 더 정확히 따라갑니다."] },
      { id: "data", type: "data", kicker: "Framework", title: "프롬프트 구조", table: [["Goal", "무엇을 만들지"], ["Context", "배경 정보"], ["Constraints", "길이·형식·금지 사항"]] },
      { id: "checklist", type: "checklist", kicker: "Checklist", title: "검토 항목", items: ["목적이 한 문장으로 명확한가", "대상 독자가 드러나는가", "출력 형식이 지정되었는가", "검토 기준이 있는가"] },
      { id: "closing", type: "closing", kicker: "Next", title: "다음 장에서는\n예시 기반 제어를\n배웁니다." }
    ]
  },
  "quiet-fiction": {
    sampleBookTitle: "창가에 남은 대화",
    samplePages: [
      { id: "cover", type: "cover", kicker: "A QUIET FICTION SAMPLE", title: "창가에\n남은 대화", subtitle: "조용한 도시의 밤과 두 사람의 거리" },
      { id: "toc", type: "toc", kicker: "Contents", title: "목차", items: ["1장 늦은 저녁의 창문", "2장 비가 오기 전의 냄새", "3장 아직 닿지 않은 말", "4장 다시 켜지는 불빛"] },
      { id: "chapter", type: "chapter", kicker: "Chapter One", title: "늦은 저녁의\n창문", subtitle: "가볍게 흔들리는 커튼 너머로 첫 장면이 시작됩니다." },
      { id: "body", type: "body", kicker: "Scene", title: "본문", body: ["버스가 지나갈 때마다 창문이 아주 조금 떨렸다. 그는 그 진동을 들으며 컵의 가장자리를 천천히 돌렸다.", "말을 꺼내기 전의 침묵은 늘 이상하게도 더 많은 이야기를 품고 있었다."] },
      { id: "quote", type: "quote", kicker: "Monologue", title: "어쩌면 우리는\n이미 너무 오래\n망설이고 있었는지도\n몰랐다.", subtitle: "— 마음속 독백" },
      { id: "body-2", type: "body", kicker: "Dialogue", title: "대화", body: ["\"오늘은 조금 늦었네.\"", "\"응. 오다가 비 냄새가 나서 잠깐 걸었어.\""] },
      { id: "closing", type: "closing", kicker: "Next Scene", title: "다음 장면은\n비가 오기 직전의\n골목으로 이어집니다." }
    ]
  }
};

export const builtInTemplateCards: TemplateCard[] = [
  { id: "modern-editorial", name: "Modern Editorial", note: "넓은 여백 · 선명한 장 구분 · 절제된 강조", description: "프리미엄 에세이와 비즈니스 책에 잘 맞는 차분한 에디토리얼 템플릿입니다.", useCases: ["에세이", "비즈니스", "자기계발"], isSystem: true, baseTemplateId: "modern-editorial", ...sampleSets["modern-editorial"] },
  { id: "minimal-tech", name: "Minimal Tech", note: "명확한 계층 · 표/코드 중심 · 정밀한 리듬", description: "설명서와 기술 문서에 잘 맞는 선명하고 구조적인 템플릿입니다.", useCases: ["기술서", "튜토리얼", "교육용"], isSystem: true, baseTemplateId: "minimal-tech", ...sampleSets["minimal-tech"] },
  { id: "quiet-fiction", name: "Quiet Fiction", note: "읽기 중심 · 낮은 시각 밀도 · 장면 중심 흐름", description: "장면과 감정의 호흡을 살리는 소설형 템플릿입니다.", useCases: ["소설", "에세이", "문학"], isSystem: true, baseTemplateId: "quiet-fiction", ...sampleSets["quiet-fiction"] }
];

export function getBuiltInTemplateCard(templateId: string) {
  return builtInTemplateCards.find((item) => item.id === templateId) ?? builtInTemplateCards[0];
}

export function customTemplateToCard(input: {
  id: string;
  name: string;
  description?: string;
  baseTemplateId: string;
  accentColor?: string;
  paperTone?: string;
  headingFamily?: "serif" | "sans";
  bodyFamily?: "serif" | "sans";
  spacingScale?: "tight" | "balanced" | "airy";
  contentWidth?: "narrow" | "medium" | "wide";
  chapterStyle?: "classic" | "bold" | "minimal";
  quoteStyle?: "line" | "box" | "indent";
}): TemplateCard {
  const base = getBuiltInTemplateCard(input.baseTemplateId);
  return {
    ...base,
    ...input,
    note: `${base.name} 기반 · 사용자 템플릿`,
    description: input.description || `${base.name}를 기반으로 직접 만든 템플릿입니다.`,
    isSystem: false,
    sampleBookTitle: base.sampleBookTitle,
    samplePages: base.samplePages
  };
}
