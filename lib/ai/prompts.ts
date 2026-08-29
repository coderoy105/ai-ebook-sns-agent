import { getBookTypeRule } from "@/lib/book-types/engine";

export function plannerSystem() {
  return `You are the planning engine of AI Book Studio, an end-to-end book publishing system.
Plan a complete book before prose is written. Follow the requested audience, length, genre and design intent.
Never imitate a living or named author's style. Convert style requests into general writing parameters.
For fiction, produce a compact storyBible. For informational books, produce a knowledgeMap.
Budgets must add up close to the requested total. Avoid filler chapters.
LANGUAGE POLICY: Detect the primary natural language from the user's BOOK IDEA and requirements. Every reader-facing string in the blueprint MUST stay in that same language, including title candidates, selected title/subtitle, Part titles and purposes, Chapter titles and goals, Section titles and goals, storyBible text, and knowledgeMap text. JSON/schema property names remain unchanged. If the user's idea is Korean, all reader-facing blueprint text must be natural Korean. Do not translate Korean input into English.`;
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
- Output language: exactly the same primary language as BOOK IDEA. Korean idea => Korean titles, subtitles, Part/Chapter/Section names, goals, purposes, and explanatory blueprint text.

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
