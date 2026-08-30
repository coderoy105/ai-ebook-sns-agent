import { getBookTypeRule } from "@/lib/book-types/engine";

export function plannerSystem() {
  return `You are the planning engine of AI Book Studio, an end-to-end book publishing system.
Plan a complete book before prose is written. Follow the requested audience, length, genre and design intent.
Never imitate a living or named author's style. Convert style requests into general writing parameters.
For fiction, fill storyBible and keep knowledgeMap compact/empty. For informational books, fill knowledgeMap and keep storyBible compact/empty.
Both storyBible and knowledgeMap always use the fixed fields summary, facts, entities, constraints. For an irrelevant container, use an empty summary and empty arrays rather than inventing content.
Budgets must add up close to the requested total. Avoid filler chapters.
LANGUAGE POLICY: Detect the primary natural language from the user's BOOK IDEA and requirements. Every reader-facing string in the blueprint MUST stay in that same language, including title candidates, selected title/subtitle, Part titles and purposes, Chapter titles and goals, Section titles and goals, storyBible text, and knowledgeMap text. JSON/schema property names remain unchanged. If the user's idea is Korean, all reader-facing blueprint text must be natural Korean. Do not translate Korean input into English.`;
}

export type PlannerInput = {
  idea: string;
  bookType: string;
  targetPages: number;
  targetWords: number;
  audience: string;
  ageGroup: string;
  knowledgeLevel: string;
  tone: string;
  templateMood: string;
};

function plannerRequirements(input: PlannerInput) {
  const rule = getBookTypeRule(input.bookType);
  return `BOOK IDEA:
${input.idea}

REQUIREMENTS:
- Book type: ${input.bookType}
- Audience: ${input.audience}
- Age group: ${input.ageGroup}
- Knowledge level: ${input.knowledgeLevel}
- Tone: ${input.tone}
- Target pages: ${input.targetPages}
- Target words: ${input.targetWords}
- Template mood: ${input.templateMood}
- Genre engine rules: ${rule.rules.join(", ")}
- Preferred chapter count: ${rule.chapterRange[0]}-${rule.chapterRange[1]}
- Preferred sections/chapter: ${rule.sectionRange[0]}-${rule.sectionRange[1]}
- Output language: exactly the same primary language as BOOK IDEA. Korean idea => Korean titles, subtitles, Part/Chapter/Section names, goals, purposes, and explanatory blueprint text.`;
}

export function plannerPrompt(input: PlannerInput) {
  return `${plannerRequirements(input)}

Produce at least 7 title candidates with materially different positioning. Then select one.
Create a hierarchical Part > Chapter > Section plan. Every section needs a concrete goal, word budget, research flag, and layout hint.
Do not write the actual book prose yet.`;
}

export function plannerSkeletonPrompt(input: PlannerInput) {
  return `${plannerRequirements(input)}

FREE MODE STAGE 1 — COMPACT BOOK SKELETON:
- Produce 5-7 concise title candidates, then select one.
- Create the complete Part > Chapter hierarchy, but DO NOT create Sections yet.
- Each Chapter needs only title, goal, targetWords, and dependencies.
- Keep every descriptive string concise. This stage must fit comfortably in a small JSON response.
- Preserve explicit constraints from the user's idea exactly. If the idea says the story begins on day 30, the first chapter must begin on day 30, not day 1.
- storyBible and knowledgeMap both use exactly these fields: summary, facts, entities, constraints. Fill the genre-relevant one compactly; use empty summary/arrays for the irrelevant one.
- Do not write prose and do not claim live research was performed.`;
}

export function chapterSectionsPrompt(input: {
  form: PlannerInput;
  selectedTitle: string;
  coreMessage: string;
  partTitle: string;
  partPurpose: string;
  chapterTitle: string;
  chapterGoal: string;
  chapterTargetWords: number;
  preferredSectionMin: number;
  preferredSectionMax: number;
}) {
  return `${plannerRequirements(input.form)}

FREE MODE STAGE 2 — SECTIONS FOR ONE CHAPTER ONLY:
Book: ${input.selectedTitle}
Core message: ${input.coreMessage}
Part: ${input.partTitle}
Part purpose: ${input.partPurpose}
Chapter: ${input.chapterTitle}
Chapter goal: ${input.chapterGoal}
Chapter target words: ${input.chapterTargetWords}
Preferred section count: ${input.preferredSectionMin}-${input.preferredSectionMax}

Create Sections ONLY for this one Chapter.
- Return ${input.preferredSectionMin}-${input.preferredSectionMax} non-overlapping Sections when practical.
- Section targetWords should add up close to the Chapter target words.
- Every Section needs title, concrete goal, targetWords, researchNeeded, and a short layoutHint.
- Preserve chronology, facts, names, and explicit constraints from the BOOK IDEA and Chapter goal.
- Keep all reader-facing strings in the BOOK IDEA language.
- Keep strings concise and do not write actual prose.`;
}

export function sectionWriterSystem() {
  return `You are the long-form writing engine of AI Book Studio.
Write only the requested section, not future sections. Maintain continuity with supplied memory and terminology.
Do not repeat previously explained material unless explicitly deepening it.
Respect the reader profile and writing style. Hit the target word budget within roughly ±15%.
When research evidence is supplied, never invent citations or URLs. When no evidence exists, set sourceUrl to null.
LANGUAGE POLICY: Write the section and its returned title in the primary language of the BOOK idea and reader requirements. If the BOOK idea is Korean, write natural Korean even when an existing Chapter or Section title happens to be English. Preserve proper nouns only where appropriate.
Output clean Markdown in the markdown field.`;
}

export function sectionWriterPrompt(input: {
  bookSummary: string;
  chapterTitle: string;
  chapterGoal: string;
  sectionTitle: string;
  sectionGoal: string;
  targetWords: number;
  readerProfile: unknown;
  writingStyle: unknown;
  relevantMemory: unknown[];
  previousSectionSummary?: string;
  researchNotes?: string;
  storyBible?: unknown;
  knowledgeMap?: unknown;
}) {
  return `BOOK:
${input.bookSummary}

CHAPTER:
${input.chapterTitle}
Goal: ${input.chapterGoal}

SECTION:
${input.sectionTitle}
Goal: ${input.sectionGoal}
Target words: ${input.targetWords}

READER PROFILE:
${JSON.stringify(input.readerProfile)}

WRITING STYLE:
${JSON.stringify(input.writingStyle)}

RELEVANT MEMORY:
${JSON.stringify(input.relevantMemory)}

PREVIOUS SECTION SUMMARY:
${input.previousSectionSummary ?? "None"}

RESEARCH NOTES:
${input.researchNotes ?? "None"}

STORY BIBLE:
${JSON.stringify(input.storyBible ?? null)}

KNOWLEDGE MAP:
${JSON.stringify(input.knowledgeMap ?? null)}

Write the section now. Preserve all established facts and names. Add genuinely new value compared with memory. Keep the reader-facing output in the same primary language as the BOOK idea.`;
}
