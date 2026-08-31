export type CoverStyle = "editorial" | "bold-commercial" | "minimal-literary" | "conceptual";
export type CoverComposition = "threshold" | "orbit" | "signal" | "archive" | "horizon" | "monolith" | "thread" | "constellation" | "window" | "cut-paper" | "typographic" | "field";
export type CoverLayout = "publisher-grid" | "poster" | "quiet-literary" | "split-field" | "museum";
export type CoverFinish = "uncoated" | "soft-touch" | "cloth";

export type CoverConcept = {
  version: 2;
  style: CoverStyle;
  styleLabel: string;
  palette: {
    name: string;
    background: string;
    foreground: string;
    accent: string;
    secondary: string;
  };
  composition: CoverComposition;
  motif: string;
  motifLabel: string;
  visualMetaphor: string;
  mood: string;
  typography: {
    family: "serif" | "sans" | "condensed";
    alignment: "left" | "center";
    titleScale: "large" | "xlarge";
  };
  layout: CoverLayout;
  finish: CoverFinish;
  kicker: string;
  editionLabel: string;
  imprint: string;
  catalogue: string;
  rationale: string;
  avoidCliches: string[];
  seed: number;
  generation: number;
};

export type CoverConceptInput = {
  title: string;
  subtitle?: string | null;
  bookType?: string | null;
  idea?: string | null;
  coreMessage?: string | null;
  templateMood?: string | null;
};

const palettes = [
  { name: "Charcoal Vermilion", background: "#171817", foreground: "#f4efe4", accent: "#ef5a42", secondary: "#8d938d" },
  { name: "Ivory Cobalt", background: "#f2eee4", foreground: "#17213a", accent: "#2456c7", secondary: "#a34f39" },
  { name: "Forest Parchment", background: "#e8e3d5", foreground: "#20372d", accent: "#a64432", secondary: "#6e7b68" },
  { name: "Burgundy Blush", background: "#eaded8", foreground: "#321d28", accent: "#863c58", secondary: "#c86b4e" },
  { name: "International Red", background: "#e84a36", foreground: "#171512", accent: "#f6ebd7", secondary: "#74221b" },
  { name: "Navy Citron", background: "#151a21", foreground: "#f2f0e7", accent: "#c2cf54", secondary: "#58729d" },
  { name: "Slate Mist", background: "#dce4e5", foreground: "#19292e", accent: "#c94f3b", secondary: "#667f87" },
  { name: "Black Ochre", background: "#20201d", foreground: "#efe5d2", accent: "#c99b36", secondary: "#788078" },
  { name: "Dust Rose", background: "#e7d5d1", foreground: "#281d1d", accent: "#a53d50", secondary: "#77675f" },
  { name: "Ivory Ultramarine", background: "#f4f0e6", foreground: "#151619", accent: "#384fd8", secondary: "#d76442" },
  { name: "Teal Linen", background: "#dfe7df", foreground: "#17302f", accent: "#0f6f72", secondary: "#b4543f" },
  { name: "Aubergine Stone", background: "#ded8d3", foreground: "#2d2030", accent: "#67425f", secondary: "#9a6844" }
] as const;

const styleLabels: Record<CoverStyle, string> = {
  editorial: "Publisher Editorial",
  "bold-commercial": "Commercial Poster",
  "minimal-literary": "Literary Edition",
  conceptual: "Concept Cover"
};

const compositionOrder: CoverComposition[] = [
  "threshold", "orbit", "signal", "archive", "horizon", "monolith", "thread", "constellation", "window", "cut-paper", "typographic", "field"
];

const layoutOrder: CoverLayout[] = ["publisher-grid", "poster", "quiet-literary", "split-field", "museum"];
const finishOrder: CoverFinish[] = ["uncoated", "soft-touch", "cloth"];

const motifMap: Array<{ test: RegExp; motif: string; label: string; composition: CoverComposition; metaphor: string }> = [
  { test: /기억|memory|회상|과거|기록|archive/i, motif: "memory-fragment", label: "기억의 조각", composition: "archive", metaphor: "흩어진 기록이 하나의 의미로 다시 정렬되는 순간" },
  { test: /ai|인공지능|컴퓨터|코드|기술|데이터|algorithm|future|미래/i, motif: "signal-trace", label: "신호의 흔적", composition: "signal", metaphor: "잡음 속에서 하나의 신호가 선명해지는 순간" },
  { test: /미스터리|추리|비밀|실종|사건|mystery|crime|thriller/i, motif: "hidden-door", label: "감춰진 문", composition: "threshold", metaphor: "보이는 세계 뒤에 또 하나의 입구가 숨어 있는 장면" },
  { test: /사랑|로맨스|연애|관계|love|romance|이별/i, motif: "paired-thread", label: "두 개의 선", composition: "thread", metaphor: "멀어졌다 다시 가까워지는 두 개의 궤적" },
  { test: /바다|제주|섬|파도|ocean|sea|여행|travel/i, motif: "distant-horizon", label: "먼 수평선", composition: "horizon", metaphor: "익숙한 경계를 넘어 새로운 풍경이 시작되는 선" },
  { test: /자연|생태|식물|숲|환경|nature|ecology|climate/i, motif: "living-network", label: "살아 있는 연결", composition: "constellation", metaphor: "서로 떨어져 보이는 존재가 하나의 생태망으로 이어지는 구조" },
  { test: /성공|사업|창업|돈|경제|투자|business|startup|finance/i, motif: "rising-block", label: "움직이는 구조", composition: "monolith", metaphor: "고정된 판을 밀어 올리는 하나의 단단한 구조" },
  { test: /학교|학생|공부|교육|학습|입문|guide|education|learn/i, motif: "open-frame", label: "열린 프레임", composition: "window", metaphor: "복잡한 세계를 이해 가능한 창으로 정리하는 장면" },
  { test: /철학|에세이|마음|감정|삶|죽음|고독|essay|philosophy/i, motif: "quiet-field", label: "빈 공간", composition: "field", metaphor: "말보다 여백이 더 오래 남는 한 장면" },
  { test: /역사|사회|정치|문화|history|society|culture/i, motif: "layered-record", label: "겹쳐진 기록", composition: "cut-paper", metaphor: "서로 다른 시대의 층이 한 장 안에서 맞물리는 구조" }
];

const clichéMap: Array<{ test: RegExp; values: string[] }> = [
  { test: /ai|인공지능|컴퓨터|코드|기술/i, values: ["빛나는 AI 뇌", "파란 회로판", "휴머노이드 얼굴", "과도한 네온"] },
  { test: /사랑|로맨스|연애/i, values: ["마주 보는 남녀 실루엣", "하트 아이콘", "장미 꽃잎 남발"] },
  { test: /성공|사업|자기계발|돈|경제/i, values: ["상승 화살표", "계단 위 사람", "악수 사진", "전구 아이콘"] },
  { test: /미스터리|추리|스릴러/i, values: ["피 묻은 칼", "후드 쓴 인물", "과도한 붉은 안개"] },
  { test: /판타지|fantasy/i, values: ["무의미한 성", "거대한 달", "안개 속 검은 실루엣"] }
];

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function inputText(input: CoverConceptInput) {
  return `${input.title} ${input.subtitle ?? ""} ${input.bookType ?? ""} ${input.idea ?? ""} ${input.coreMessage ?? ""}`.toLowerCase();
}

function styleOrder(input: CoverConceptInput): CoverStyle[] {
  const text = inputText(input);
  if (/소설|fiction|문학|에세이|essay|시집|poetry/.test(text)) return ["minimal-literary", "conceptual", "editorial"];
  if (/자기계발|경제|경영|business|startup|마케팅|실용|투자/.test(text)) return ["bold-commercial", "editorial", "conceptual"];
  if (/기술|ai|인공지능|컴퓨터|과학|science|tech|데이터/.test(text)) return ["editorial", "conceptual", "bold-commercial"];
  return ["editorial", "minimal-literary", "conceptual"];
}

function palettePool(input: CoverConceptInput) {
  const text = inputText(input);
  if (/ai|인공지능|컴퓨터|기술|데이터|과학|science|tech/.test(text)) return [1, 9, 0, 6, 10, 5];
  if (/학교|학생|교육|입문|학습|guide|education/.test(text)) return [1, 6, 2, 9, 10];
  if (/소설|문학|에세이|essay|철학|마음|감정/.test(text)) return [2, 3, 8, 11, 7];
  if (/미스터리|추리|thriller|crime/.test(text)) return [0, 7, 11, 4];
  if (/사랑|로맨스|연애|romance/.test(text)) return [3, 8, 11, 2];
  if (/경제|경영|사업|startup|투자|finance/.test(text)) return [0, 4, 7, 9, 5];
  if (/자연|환경|바다|제주|여행|nature|travel/.test(text)) return [2, 10, 6, 1, 7];
  return palettes.map((_, index) => index);
}

function typographyFor(style: CoverStyle, seed: number): CoverConcept["typography"] {
  if (style === "minimal-literary") return { family: "serif", alignment: seed % 3 === 0 ? "center" : "left", titleScale: "large" };
  if (style === "bold-commercial") return { family: seed % 2 === 0 ? "condensed" : "sans", alignment: "left", titleScale: "xlarge" };
  if (style === "conceptual") return { family: seed % 2 === 0 ? "serif" : "sans", alignment: seed % 4 === 0 ? "center" : "left", titleScale: "large" };
  return { family: seed % 3 === 0 ? "serif" : "sans", alignment: "left", titleScale: seed % 2 === 0 ? "xlarge" : "large" };
}

function layoutFor(style: CoverStyle, seed: number): CoverLayout {
  if (style === "minimal-literary") return seed % 4 === 0 ? "museum" : "quiet-literary";
  if (style === "bold-commercial") return "poster";
  if (style === "conceptual") return seed % 3 === 0 ? "split-field" : "museum";
  return seed % 2 === 0 ? "publisher-grid" : "split-field";
}

function finishFor(style: CoverStyle, seed: number): CoverFinish {
  if (style === "minimal-literary") return seed % 3 === 0 ? "cloth" : "uncoated";
  if (style === "bold-commercial") return "soft-touch";
  if (style === "conceptual") return seed % 2 === 0 ? "uncoated" : "cloth";
  return "uncoated";
}

function kickerFor(bookType: string | null | undefined, style: CoverStyle) {
  const clean = (bookType ?? "").trim();
  if (clean) return clean;
  if (style === "minimal-literary") return "LITERARY WORK";
  if (style === "bold-commercial") return "PRACTICAL BOOK";
  if (style === "conceptual") return "CONCEPT EDITION";
  return "EDITORIAL BOOK";
}

function editionFor(input: CoverConceptInput, style: CoverStyle) {
  const text = inputText(input);
  if (/입문|beginner|intro|처음|기초/.test(text)) return "INTRODUCTORY EDITION";
  if (/학생|학교|교육|학습/.test(text)) return "LEARNING EDITION";
  if (style === "minimal-literary") return "LITERARY EDITION";
  if (style === "bold-commercial") return "PRACTICAL EDITION";
  if (style === "conceptual") return "CONCEPT EDITION";
  return "CONTEMPORARY EDITION";
}

function avoidCliches(input: CoverConceptInput) {
  const text = inputText(input);
  const values = clichéMap.flatMap((entry) => entry.test.test(text) ? entry.values : []);
  return values.length ? [...new Set(values)] : ["무의미한 스톡 이미지", "장르와 관계없는 장식", "과도한 3D 광택", "AI 특유의 네온 배경"];
}

function motifFor(input: CoverConceptInput, fallbackSeed: number) {
  const text = inputText(input);
  return motifMap.find((entry) => entry.test.test(text)) ?? {
    motif: "editorial-mark",
    label: "핵심의 흔적",
    composition: compositionOrder[fallbackSeed % compositionOrder.length],
    metaphor: "책의 핵심 문장을 하나의 시각적 흔적으로 압축한 장면"
  };
}

export function createCoverConcepts(input: CoverConceptInput, generation = 0): CoverConcept[] {
  const baseSeed = hashText(`${input.title}|${input.subtitle ?? ""}|${input.bookType ?? ""}|${input.idea ?? ""}|${input.coreMessage ?? ""}|${generation}`);
  const motif = motifFor(input, baseSeed);
  const styles = styleOrder(input);
  const avoid = avoidCliches(input);
  const mood = [input.templateMood, input.bookType, motif.label].filter(Boolean).join(" · ");
  const pool = palettePool(input);

  return styles.map((style, index) => {
    const seed = (baseSeed + Math.imul(index + 1, 2654435761)) >>> 0;
    const paletteIndex = pool[(seed + generation + index * 2) % pool.length] ?? 0;
    const palette = palettes[paletteIndex];
    const composition = index === 0
      ? motif.composition
      : compositionOrder[(compositionOrder.indexOf(motif.composition) + 3 + index * 2 + generation) % compositionOrder.length];
    const visualMetaphor = index === 0
      ? motif.metaphor
      : `${motif.metaphor} — ${styleLabels[style]} 방식으로 ${style === "bold-commercial" ? "더 직접적이고 강한 포스터 문법" : style === "minimal-literary" ? "더 절제된 문학적 여백" : "더 낯설고 상징적인 편집 문법"}으로 재해석`;

    return {
      version: 2,
      style,
      styleLabel: styleLabels[style],
      palette: { ...palette },
      composition,
      motif: motif.motif,
      motifLabel: motif.label,
      visualMetaphor,
      mood: mood || "publisher-grade editorial",
      typography: typographyFor(style, seed),
      layout: layoutFor(style, seed),
      finish: finishFor(style, seed),
      kicker: kickerFor(input.bookType, style),
      editionLabel: editionFor(input, style),
      imprint: "AI BOOK STUDIO",
      catalogue: `ABS-${String(seed % 1000).padStart(3, "0")}`,
      rationale: `${motif.label}을 핵심 상징으로 압축하고 ${palette.name} 팔레트, ${layoutFor(style, seed)} 레이아웃, ${finishFor(style, seed)} 인쇄 질감을 결합했습니다. 장식보다 제목 계층과 여백을 우선해 실제 서점 진열에서도 읽히는 표지를 목표로 합니다.`,
      avoidCliches: avoid,
      seed,
      generation
    };
  });
}

function safePalette(value: unknown, fallback: CoverConcept["palette"]): CoverConcept["palette"] {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  if (Array.isArray(value)) return fallback;
  return {
    name: typeof record.name === "string" ? record.name : fallback.name,
    background: typeof record.background === "string" ? record.background : fallback.background,
    foreground: typeof record.foreground === "string" ? record.foreground : fallback.foreground,
    accent: typeof record.accent === "string" ? record.accent : fallback.accent,
    secondary: typeof record.secondary === "string" ? record.secondary : fallback.secondary
  };
}

export function normalizeCoverConcept(value: unknown, input: CoverConceptInput): CoverConcept {
  const fallback = createCoverConcepts(input, 0)[0];
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  if (record.version !== 2) return fallback;
  const style = (["editorial", "bold-commercial", "minimal-literary", "conceptual"] as string[]).includes(String(record.style))
    ? record.style as CoverStyle
    : fallback.style;
  const composition = compositionOrder.includes(record.composition as CoverComposition)
    ? record.composition as CoverComposition
    : fallback.composition;
  const typography = record.typography && typeof record.typography === "object"
    ? record.typography as Record<string, unknown>
    : {};
  const layout = layoutOrder.includes(record.layout as CoverLayout) ? record.layout as CoverLayout : layoutFor(style, Number(record.seed ?? fallback.seed));
  const finish = finishOrder.includes(record.finish as CoverFinish) ? record.finish as CoverFinish : finishFor(style, Number(record.seed ?? fallback.seed));

  return {
    ...fallback,
    version: 2,
    style,
    styleLabel: typeof record.styleLabel === "string" ? record.styleLabel : styleLabels[style],
    palette: safePalette(record.palette, fallback.palette),
    composition,
    motif: typeof record.motif === "string" ? record.motif : fallback.motif,
    motifLabel: typeof record.motifLabel === "string" ? record.motifLabel : fallback.motifLabel,
    visualMetaphor: typeof record.visualMetaphor === "string" ? record.visualMetaphor : fallback.visualMetaphor,
    mood: typeof record.mood === "string" ? record.mood : fallback.mood,
    typography: {
      family: ["serif", "sans", "condensed"].includes(String(typography.family)) ? typography.family as CoverConcept["typography"]["family"] : fallback.typography.family,
      alignment: typography.alignment === "center" ? "center" : "left",
      titleScale: typography.titleScale === "xlarge" ? "xlarge" : "large"
    },
    layout,
    finish,
    kicker: typeof record.kicker === "string" ? record.kicker : fallback.kicker,
    editionLabel: typeof record.editionLabel === "string" ? record.editionLabel : editionFor(input, style),
    imprint: typeof record.imprint === "string" ? record.imprint : "AI BOOK STUDIO",
    catalogue: typeof record.catalogue === "string" ? record.catalogue : `ABS-${String(Number(record.seed ?? fallback.seed) % 1000).padStart(3, "0")}`,
    rationale: typeof record.rationale === "string" ? record.rationale : fallback.rationale,
    avoidCliches: Array.isArray(record.avoidCliches) ? record.avoidCliches.filter((item): item is string => typeof item === "string").slice(0, 8) : fallback.avoidCliches,
    seed: Number.isFinite(Number(record.seed)) ? Number(record.seed) : fallback.seed,
    generation: Number.isFinite(Number(record.generation)) ? Number(record.generation) : fallback.generation
  };
}
