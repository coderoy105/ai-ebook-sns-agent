export type BookFamily = "NONFICTION" | "FICTION" | "ESSAY" | "EDUCATION" | "CHILDREN" | "TECHNICAL" | "MANUAL";

export type BookTypeRule = {
  id: string;
  family: BookFamily;
  label: string;
  recommendedWordsPerPage: number;
  chapterRange: [number, number];
  sectionRange: [number, number];
  rules: string[];
  citationDefault: "none" | "light" | "standard" | "research";
  designGenre: "novel" | "business" | "children" | "technical" | "essay";
};

const rules: BookTypeRule[] = [
  { id: "ai-guide", family: "NONFICTION", label: "AI / 실용서", recommendedWordsPerPage: 330, chapterRange: [8, 18], sectionRange: [3, 7], citationDefault: "standard", designGenre: "business", rules: ["concept-first", "examples", "progressive-depth", "actionable-summary"] },
  { id: "business", family: "NONFICTION", label: "비즈니스 / 창업", recommendedWordsPerPage: 320, chapterRange: [8, 16], sectionRange: [3, 6], citationDefault: "standard", designGenre: "business", rules: ["problem-solution", "case-studies", "frameworks", "metrics"] },
  { id: "education", family: "EDUCATION", label: "교육용", recommendedWordsPerPage: 270, chapterRange: [8, 18], sectionRange: [3, 6], citationDefault: "light", designGenre: "business", rules: ["scaffolded-learning", "recap", "exercise", "age-fit"] },
  { id: "technical", family: "TECHNICAL", label: "기술서", recommendedWordsPerPage: 300, chapterRange: [8, 22], sectionRange: [3, 8], citationDefault: "research", designGenre: "technical", rules: ["prerequisites", "definitions", "code", "verification", "troubleshooting"] },
  { id: "mystery-romance", family: "FICTION", label: "미스터리 로맨스", recommendedWordsPerPage: 280, chapterRange: [18, 45], sectionRange: [2, 6], citationDefault: "none", designGenre: "novel", rules: ["scene-driven", "dual-tension", "clues", "relationship-arc", "reveal-control"] },
  { id: "sf-mystery", family: "FICTION", label: "SF 미스터리", recommendedWordsPerPage: 285, chapterRange: [18, 45], sectionRange: [2, 6], citationDefault: "none", designGenre: "novel", rules: ["world-rules", "clues", "causal-timeline", "foreshadowing", "controlled-reveals"] },
  { id: "essay", family: "ESSAY", label: "에세이", recommendedWordsPerPage: 240, chapterRange: [8, 24], sectionRange: [1, 4], citationDefault: "none", designGenre: "essay", rules: ["voice-led", "reflection", "image-space", "rhythm"] },
  { id: "children", family: "CHILDREN", label: "아동용", recommendedWordsPerPage: 90, chapterRange: [8, 24], sectionRange: [1, 3], citationDefault: "none", designGenre: "children", rules: ["short-sentences", "visual-beats", "repetition-with-purpose", "simple-vocabulary"] },
  { id: "manual", family: "MANUAL", label: "매뉴얼 / 튜토리얼", recommendedWordsPerPage: 260, chapterRange: [6, 16], sectionRange: [3, 8], citationDefault: "light", designGenre: "technical", rules: ["stepwise", "checklists", "warnings", "verification"] }
];

const aliases: Record<string, string> = {
  "ai / 실용서": "ai-guide",
  "비즈니스 / 창업": "business",
  "교육용": "education",
  "기술서": "technical",
  "미스터리 로맨스": "mystery-romance",
  "sf 미스터리": "sf-mystery",
  "에세이": "essay",
  "아동용": "children",
  "매뉴얼 / 튜토리얼": "manual"
};

export function getBookTypeRule(bookType: string) {
  const normalized = bookType.toLowerCase().trim();
  const id = aliases[normalized] ?? normalized;
  return rules.find((rule) => rule.id === id) ??
    rules.find((rule) => normalized.includes(rule.id)) ??
    rules[0];
}

export function computeWordBudget(targetPages: number, bookType: string) {
  const rule = getBookTypeRule(bookType);
  return Math.max(1200, Math.round(targetPages * rule.recommendedWordsPerPage));
}

export function listBookTypes() {
  return rules;
}
