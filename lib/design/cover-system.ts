export type CoverStyle = "editorial" | "bold-commercial" | "minimal-literary" | "conceptual";
export type CoverComposition = "threshold" | "orbit" | "signal" | "archive" | "horizon" | "monolith" | "thread" | "constellation" | "window" | "cut-paper" | "typographic" | "field";

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
  kicker: string;
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
  { name: "Noir Coral", background: "#111318", foreground: "#f5efe5", accent: "#e25f4d", secondary: "#7e8aa0" },
  { name: "Cobalt Paper", background: "#f1efe8", foreground: "#18213b", accent: "#3156d8", secondary: "#b96545" },
  { name: "Moss Cream", background: "#ece8dc", foreground: "#24352c", accent: "#a74735", secondary: "#71806a" },
  { name: "Plum Sand", background: "#e9dfd4", foreground: "#31202f", accent: "#7a405f", secondary: "#d06f48" },
  { name: "Vermilion Ink", background: "#e94f37", foreground: "#181511", accent: "#f7edda", secondary: "#6c201d" },
  { name: "Midnight Lime", background: "#15191c", foreground: "#f1f4e8", accent: "#b8d83f", secondary: "#5f76a8" },
  { name: "Blue Fog", background: "#dfe7e9", foreground: "#17262d", accent: "#d0533d", secondary: "#647f8c" },
  { name: "Ochre Night", background: "#20201d", foreground: "#f2e8d4", accent: "#d2a23b", secondary: "#6f7e76" },
  { name: "Rose Charcoal", background: "#ead8d5", foreground: "#251d1c", accent: "#b33f53", secondary: "#7c6b63" },
  { name: "Electric Ivory", background: "#f4f0e6", foreground: "#171717", accent: "#4d52ff", secondary: "#e26442" }
] as const;

const styleLabels: Record<CoverStyle, string> = {
  editorial: "Editorial",
  "bold-commercial": "Bold Commercial",
  "minimal-literary": "Minimal Literary",
  conceptual: "Conceptual"
};

const compositionOrder: CoverComposition[] = [
  "threshold", "orbit", "signal", "archive", "horizon", "monolith", "thread", "constellation", "window", "cut-paper", "typographic", "field"
];

const motifMap: Array<{ test: RegExp; motif: string; label: string; composition: CoverComposition; metaphor: string }> = [
  { test: /기억|memory|회상|과거|기록|archive/i, motif: "memory-fragment", label: "기억의 조각", composition: "archive", metaphor: "흩어진 기록이 하나의 의미로 다시 정렬되는 순간" },
  { test: /ai|인공지능|컴퓨터|코드|기술|데이터|algorithm|future|미래/i, motif: "signal-trace", label: "신호의 흔적", composition: "signal", metaphor: "잡음 속에서 하나의 신호가 선명해지는 장면" },
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

function styleOrder(input: CoverConceptInput): CoverStyle[] {
  const text = `${input.bookType ?? ""} ${input.idea ?? ""}`.toLowerCase();
  if (/소설|fiction|문학|에세이|essay/.test(text)) return ["minimal-literary", "conceptual", "editorial"];
  if (/자기계발|경제|경영|business|startup|마케팅|실용/.test(text)) return ["bold-commercial", "editorial", "conceptual"];
  if (/기술|ai|인공지능|컴퓨터|과학|science|tech/.test(text)) return ["editorial", "conceptual", "bold-commercial"];
  return ["editorial", "minimal-literary", "conceptual"];
}

function typographyFor(style: CoverStyle, seed: number): CoverConcept["typography"] {
  if (style === "minimal-literary") return { family: "serif", alignment: seed % 3 === 0 ? "center" : "left", titleScale: "large" };
  if (style === "bold-commercial") return { family: seed % 2 === 0 ? "condensed" : "sans", alignment: "left", titleScale: "xlarge" };
  if (style === "conceptual") return { family: seed % 2 === 0 ? "serif" : "sans", alignment: seed % 4 === 0 ? "center" : "left", titleScale: "large" };
  return { family: seed % 3 === 0 ? "serif" : "sans", alignment: "left", titleScale: seed % 2 === 0 ? "xlarge" : "large" };
}

function kickerFor(bookType: string | null | undefined, style: CoverStyle) {
  const clean = (bookType ?? "BOOK").trim();
  if (style === "minimal-literary") return clean || "LITERARY EDITION";
  if (style === "bold-commercial") return clean || "FIELD GUIDE";
  if (style === "conceptual") return clean || "A VISUAL ESSAY";
  return clean || "EDITORIAL EDITION";
}

function avoidCliches(input: CoverConceptInput) {
  const text = `${input.title} ${input.subtitle ?? ""} ${input.bookType ?? ""} ${input.idea ?? ""}`;
  const values = clichéMap.flatMap((entry) => entry.test.test(text) ? entry.values : []);
  return values.length ? [...new Set(values)] : ["무의미한 스톡 이미지", "장르와 관계없는 장식", "과도한 3D 광택", "AI 특유의 네온 배경"];
}

function motifFor(input: CoverConceptInput, fallbackSeed: number) {
  const text = `${input.title} ${input.subtitle ?? ""} ${input.bookType ?? ""} ${input.idea ?? ""} ${input.coreMessage ?? ""}`;
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

  return styles.map((style, index) => {
    const seed = (baseSeed + Math.imul(index + 1, 2654435761)) >>> 0;
    const palette = palettes[(seed + generation + index * 3) % palettes.length];
    const composition = index === 0
      ? motif.composition
      : compositionOrder[(compositionOrder.indexOf(motif.composition) + 3 + index * 2 + generation) % compositionOrder.length];
    const visualMetaphor = index === 0
      ? motif.metaphor
      : `${motif.metaphor} — ${styleLabels[style]} 방식으로 더 ${style === "bold-commercial" ? "직관적이고 강하게" : style === "minimal-literary" ? "절제되고 문학적으로" : "낯설고 상징적으로"} 재해석`;

    return {
      version: 2,
      style,
      styleLabel: styleLabels[style],
      palette: { ...palette },
      composition,
      motif: motif.motif,
      motifLabel: motif.label,
      visualMetaphor,
      mood: mood || "distinctive editorial",
      typography: typographyFor(style, seed),
      kicker: kickerFor(input.bookType, style),
      rationale: `${motif.label}을 핵심 상징으로 삼고 ${palette.name} 팔레트와 ${composition} 구도를 결합했습니다. 제목을 장식보다 우선해 작은 썸네일에서도 책의 성격이 남도록 설계했습니다.`,
      avoidCliches: avoid,
      seed,
      generation
    };
  });
}

function safePalette(value: unknown, fallback: CoverConcept["palette"]): CoverConcept["palette"] {
  if (!value || typeof value !== "object") return fallback;
  const record = value as Record<string, unknown>;
  const legacy = Array.isArray(value) ? value : null;
  if (legacy) return fallback;
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
    kicker: typeof record.kicker === "string" ? record.kicker : fallback.kicker,
    rationale: typeof record.rationale === "string" ? record.rationale : fallback.rationale,
    avoidCliches: Array.isArray(record.avoidCliches) ? record.avoidCliches.filter((item): item is string => typeof item === "string").slice(0, 8) : fallback.avoidCliches,
    seed: Number.isFinite(Number(record.seed)) ? Number(record.seed) : fallback.seed,
    generation: Number.isFinite(Number(record.generation)) ? Number(record.generation) : fallback.generation
  };
}
