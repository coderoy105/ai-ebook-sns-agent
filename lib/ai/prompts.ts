import { getBookTypeRule, planBookLength } from "@/lib/book-types/engine";

export function plannerSystem() {
  return `You are the planning engine of AI Book Studio, an end-to-end book publishing system.
Plan a complete book before prose is written. Follow the requested audience, length, genre and design intent.
Never imitate a living or named author's style. Convert style requests into general writing parameters.
For fiction, fill storyBible and keep knowledgeMap compact/empty. For informational books, fill knowledgeMap and keep storyBible compact/empty.
Both storyBible and knowledgeMap always use the fixed fields summary, facts, entities, constraints. For an irrelevant container, use an empty summary and empty arrays rather than inventing content.
The requested page count is the FINAL finished-book size, not a prose-page count that can be expanded with unlimited extra chapters or sections. Length budgets and outline size are hard constraints. Budgets must add up close to the requested total. Avoid filler chapters.
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
  const length = planBookLength(input.targetPages, input.bookType);
  return `BOOK IDEA:
${input.idea}

REQUIREMENTS:
- Book type: ${input.bookType}
- Audience: ${input.audience}
- Age group: ${input.ageGroup}
- Knowledge level: ${input.knowledgeLevel}
- Tone: ${input.tone}
- FINAL published-book target: ${length.targetPages} pages total
- Front matter already reserved by the length engine: ${length.frontMatterPages} pages
- Manuscript/content budget: about ${length.contentPages} pages
- Target manuscript words: ${input.targetWords}
- Template mood: ${input.templateMood}
- Genre engine rules: ${rule.rules.join(", ")}
- REQUIRED chapter count range for this length: ${length.chapterRange[0]}-${length.chapterRange[1]}
- REQUIRED sections/chapter range for this length: ${length.sectionRange[0]}-${length.sectionRange[1]}
- Page-count rule: DO NOT apply the genre's normal long-book minimum chapter count when the requested book is short. DO NOT add extra prose pages on top of the final page target. Chapter headings belong inside the manuscript budget.
- Budget rule: the sum of all Chapter targetWords should stay within roughly ±5% of ${input.targetWords}. Never inflate individual chapter budgets merely to create more chapters.
- Output language: exactly the same primary language as BOOK IDEA. Korean idea => Korean titles, subtitles, Part/Chapter/Section names, goals, purposes, and explanatory blueprint text.`;
}

export function plannerPrompt(input: PlannerInput) {
  return `${plannerRequirements(input)}

Produce at least 7 title candidates with materially different positioning. Then select one.
Create a hierarchical Part > Chapter > Section plan within the REQUIRED length ranges. Every section needs a concrete goal, word budget, research flag, and layout hint.
The complete outline must fit the final-book page budget; fewer stronger chapters are better than filler chapters in a short book.
Do not write the actual book prose yet.`;
}

export function plannerSkeletonPrompt(input: PlannerInput) {
  const length = planBookLength(input.targetPages, input.bookType);
  return `${plannerRequirements(input)}

FREE MODE STAGE 1 — COMPACT BOOK SKELETON:
- Produce 5-7 concise title candidates, then select one.
- Create the complete Part > Chapter hierarchy, but DO NOT create Sections yet.
- Return ${length.chapterRange[0]}-${length.chapterRange[1]} Chapters TOTAL across all Parts. This is a hard range for the requested final book length.
- Each Chapter needs only title, goal, targetWords, and dependencies.
- Chapter targetWords must sum close to ${input.targetWords}; aim for ±5% total error.
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
  const length = planBookLength(input.form.targetPages, input.form.bookType);
  const sectionMin = length.sectionRange[0];
  const sectionMax = length.sectionRange[1];
  return `${plannerRequirements(input.form)}

FREE MODE STAGE 2 — SECTIONS FOR ONE CHAPTER ONLY:
Book: ${input.selectedTitle}
Core message: ${input.coreMessage}
Part: ${input.partTitle}
Part purpose: ${input.partPurpose}
Chapter: ${input.chapterTitle}
Chapter goal: ${input.chapterGoal}
Chapter target words: ${input.chapterTargetWords}
Required section count for this book length: ${sectionMin}-${sectionMax}

Create Sections ONLY for this one Chapter.
- Return ${sectionMin}-${sectionMax} non-overlapping Sections. Do not use the larger default genre range for a short book.
- Section targetWords must add up close to the Chapter target words, ideally within ±5%.
- Do not force every Section to be long; preserve the Chapter budget and the final ${length.targetPages}-page book target.
- Every Section needs title, concrete goal, targetWords, researchNeeded, and a short layoutHint.
- Preserve chronology, facts, names, and explicit constraints from the BOOK IDEA and Chapter goal.
- Keep all reader-facing strings in the BOOK IDEA language.
- Keep strings concise and do not write actual prose.`;
}

export function sectionWriterSystem() {
  return `You are the long-form writing engine of AI Book Studio.
Write only the requested section, not future sections. Maintain continuity with supplied memory and terminology.
Do not repeat previously explained material unless explicitly deepening it.
Respect the reader profile and writing style. Hit the target word budget within roughly ±15%. Never expand a short target into a generic long chapter.
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

Write the section now. Preserve all established facts and names. Add genuinely new value compared with memory. Stay close to the requested Target words rather than expanding to a generic chapter length. Keep the reader-facing output in the same primary language as the BOOK idea.`;
}
