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

export type BookLengthPlan = {
  targetPages: number;
  frontMatterPages: number;
  contentPages: number;
  wordsPerPage: number;
  targetWords: number;
  chapterRange: [number, number];
  estimatedChapters: number;
  sectionRange: [number, number];
  estimatedSectionsPerChapter: number;
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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function idealChapterCount(targetPages: number, family: BookFamily) {
  switch (family) {
    case "FICTION":
      return Math.round(3 + targetPages / 8);
    case "CHILDREN":
      return Math.round(1 + targetPages / 20);
    case "ESSAY":
      return Math.round(2 + targetPages / 18);
    default:
      return Math.round(2 + targetPages / 15);
  }
}

function preferredSectionWords(family: BookFamily) {
  if (family === "FICTION") return 900;
  if (family === "CHILDREN") return 750;
  if (family === "ESSAY") return 800;
  return 900;
}

export function getBookTypeRule(bookType: string) {
  const normalized = bookType.toLowerCase().trim();
  const id = aliases[normalized] ?? normalized;
  return rules.find((rule) => rule.id === id) ??
    rules.find((rule) => normalized.includes(rule.id)) ??
    rules[0];
}

/**
 * Converts the user's page selection into one coherent FINAL-book budget.
 * `targetPages` means the finished book, not "targetPages of prose plus extra
 * cover/TOC/chapter pages". The planner therefore reserves front matter first
 * and scales the outline down for short books instead of blindly applying the
 * normal long-book chapter minimums.
 */
export function planBookLength(targetPages: number, bookType: string): BookLengthPlan {
  const rule = getBookTypeRule(bookType);
  const pages = Math.max(4, Math.round(Number.isFinite(targetPages) ? targetPages : 20));
  const frontMatterPages = Math.min(2, pages - 1);
  const contentPages = Math.max(1, pages - frontMatterPages);
  const minimumWords = rule.family === "CHILDREN" ? 600 : 1200;
  const targetWords = Math.max(minimumWords, Math.round(contentPages * rule.recommendedWordsPerPage));

  // Background writing currently works best when a planned unit has enough
  // room for a meaningful passage. This cap prevents a 20-page book from being
  // expanded into dozens of tiny chapters/sections that each become a page.
  const chapterWordCap = Math.max(1, Math.floor(targetWords / 500));
  const maximumChapters = Math.max(1, Math.min(rule.chapterRange[1], contentPages, chapterWordCap));
  const estimatedChapters = clamp(idealChapterCount(pages, rule.family), 1, maximumChapters);
  const chapterFlex = pages <= 40 ? 1 : pages <= 120 ? 2 : 4;
  const chapterRange: [number, number] = [
    Math.max(1, estimatedChapters - chapterFlex),
    Math.min(maximumChapters, estimatedChapters + chapterFlex)
  ];

  const averageChapterWords = targetWords / estimatedChapters;
  const sectionWordCap = Math.max(1, Math.floor(averageChapterWords / 500));
  const idealSections = clamp(
    Math.round(averageChapterWords / preferredSectionWords(rule.family)),
    1,
    Math.max(1, Math.min(rule.sectionRange[1], sectionWordCap))
  );
  const sectionFlex = pages <= 60 ? 1 : 2;
  const sectionMaximum = Math.max(1, Math.min(rule.sectionRange[1], sectionWordCap, idealSections + sectionFlex));
  const sectionMinimum = Math.min(sectionMaximum, Math.max(1, idealSections - 1));
  const sectionRange: [number, number] = [sectionMinimum, sectionMaximum];

  return {
    targetPages: pages,
    frontMatterPages,
    contentPages,
    wordsPerPage: rule.recommendedWordsPerPage,
    targetWords,
    chapterRange,
    estimatedChapters,
    sectionRange,
    estimatedSectionsPerChapter: idealSections
  };
}

export function computeWordBudget(targetPages: number, bookType: string) {
  return planBookLength(targetPages, bookType).targetWords;
}

export function listBookTypes() {
  return rules;
}
