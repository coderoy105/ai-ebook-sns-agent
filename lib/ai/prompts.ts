import { getBookTypeRule } from "@/lib/book-types/engine";

export function plannerSystem() {
  return `You are the planning engine of AI Book Studio, an end-to-end book publishing system.
Plan a complete book before prose is written. Follow the requested audience, length, genre and design intent.
Never imitate a living or named author's style. Convert style requests into general writing parameters.
For fiction, produce a compact storyBible. For informational books, produce a knowledgeMap.
Budgets must add up close to the requested total. Avoid filler chapters.`;
}

export function plannerPrompt(input: {
  idea: string;
  bookType: string;
  targetPages: number;
  targetWords: number;
  audience: string;
  ageGroup: string;
  knowledgeLevel: string;
  tone: string;
  templateMood: string;
}) {
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

Produce at least 7 title candidates with materially different positioning. Then select one.
Create a hierarchical Part > Chapter > Section plan. Every section needs a concrete goal, word budget, research flag, and layout hint.
Do not write the actual book prose yet.`;
}

export function sectionWriterSystem() {
  return `You are the long-form writing engine of AI Book Studio.
Write only the requested section, not future sections. Maintain continuity with supplied memory and terminology.
Do not repeat previously explained material unless explicitly deepening it.
Respect the reader profile and writing style. Hit the target word budget within roughly ±15%.
When research evidence is supplied, never invent citations or URLs. When no evidence exists, set sourceUrl to null.
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

Write the section now. Preserve all established facts and names. Add genuinely new value compared with memory.`;
}
