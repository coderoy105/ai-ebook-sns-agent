import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { computeWordBudget, getBookTypeRule } from "@/lib/book-types/engine";
import { llm } from "@/lib/ai/openai";
import { BookBlueprintSchema, ReaderProfileSchema, WritingStyleSchema } from "@/lib/ai/schemas";
import { bookBlueprintJsonSchema } from "@/lib/ai/json-schemas";
import { plannerPrompt, plannerSystem } from "@/lib/ai/prompts";
import { estimateOpenAICost } from "@/lib/ai/provider";
import { assertRateLimit } from "@/lib/security/rate-limit";

const CreateBookSchema = z.object({
  idea: z.string().min(8).max(8000),
  bookType: z.string().min(2).max(100),
  audience: z.string().min(2).max(500),
  ageGroup: z.string().min(1).max(100),
  knowledgeLevel: z.enum(["beginner", "intermediate", "advanced", "expert"]),
  tone: z.string().min(2).max(500),
  targetPages: z.number().int().min(10).max(800),
  templateMood: z.string().min(2).max(100),
  mode: z.enum(["quick", "advanced"]).default("quick")
});

function inferReaderProfile(input: z.infer<typeof CreateBookSchema>) {
  return ReaderProfileSchema.parse({
    ageGroup: input.ageGroup,
    knowledgeLevel: input.knowledgeLevel,
    readingPurpose: `Read and apply: ${input.idea}`,
    preferredComplexity: input.knowledgeLevel === "beginner" ? 4 : input.knowledgeLevel === "intermediate" ? 6 : 8,
    tonePreference: input.tone,
    technicalTolerance: input.knowledgeLevel === "beginner" ? 4 : 7,
    examplePreference: "concrete and relevant",
    readingSpeed: "average"
  });
}

function inferWritingStyle(input: z.infer<typeof CreateBookSchema>) {
  return WritingStyleSchema.parse({
    label: input.tone,
    description: input.tone,
    sentenceLength: input.ageGroup.includes("중") || input.ageGroup.includes("초") ? 4 : 6,
    descriptionDepth: 6,
    emotionLevel: input.bookType.includes("소설") || input.bookType.includes("에세이") ? 7 : 4,
    technicalVocabulary: input.knowledgeLevel === "beginner" ? 3 : 7,
    dialogueRatio: input.bookType.includes("소설") ? 35 : 5,
    narrativeSpeed: 6
  });
}

export async function POST(request: Request) {
  try {
    const { supabase, user } = await requireUser();
    const input = CreateBookSchema.parse(await request.json());
    await assertRateLimit(user.id, "book-create", 8, 3600);
    const targetWords = computeWordBudget(input.targetPages, input.bookType);
    const reader = inferReaderProfile(input);
    const style = inferWritingStyle(input);
    const model = process.env.OPENAI_PLANNER_MODEL ?? "gpt-5";

    const generation = await llm.generateStructured({
      model,
      schemaName: "book_blueprint",
      jsonSchema: bookBlueprintJsonSchema as unknown as Record<string, unknown>,
      system: plannerSystem(),
      prompt: plannerPrompt({ ...input, targetWords }),
      parse: (value) => BookBlueprintSchema.parse(value)
    });
    const blueprint = generation.value;
    const rule = getBookTypeRule(input.bookType);

    const { data: book, error: bookError } = await supabase.from("books").insert({
      user_id: user.id,
      title: blueprint.selectedTitle,
      subtitle: blueprint.selectedSubtitle,
      idea: input.idea,
      book_type: input.bookType,
      book_family: rule.family,
      status: "PLANNING",
      target_pages: input.targetPages,
      target_words: targetWords,
      progress: 0,
      quality_scores: {}
    }).select("id").single();
    if (bookError) throw bookError;

    const bookId = book.id;
    await Promise.all([
      supabase.from("reader_profiles").insert({ book_id: bookId, ...{
        age_group: reader.ageGroup, knowledge_level: reader.knowledgeLevel, reading_purpose: reader.readingPurpose,
        preferred_complexity: reader.preferredComplexity, tone_preference: reader.tonePreference,
        technical_tolerance: reader.technicalTolerance, example_preference: reader.examplePreference, reading_speed: reader.readingSpeed
      }}),
      supabase.from("writing_styles").insert({ book_id: bookId, ...{
        label: style.label, description: style.description, sentence_length: style.sentenceLength,
        description_depth: style.descriptionDepth, emotion_level: style.emotionLevel,
        technical_vocabulary: style.technicalVocabulary, dialogue_ratio: style.dialogueRatio, narrative_speed: style.narrativeSpeed
      }}),
      supabase.from("book_blueprints").insert({ book_id: bookId, blueprint, version: 1, is_active: true }),
      supabase.from("book_settings").insert({
        book_id: bookId, target_pages: input.targetPages, target_words: targetWords, template_id: input.templateMood.toLowerCase().replace(/\s+/g, "-"), chapter_count: blueprint.parts.reduce((n,p) => n + p.chapters.length, 0),
        creativity: 6, research_depth: rule.citationDefault === "research" ? 8 : rule.citationDefault === "standard" ? 5 : 2,
        writing_density: 6, sentence_length: style.sentenceLength, vocabulary_level: style.technicalVocabulary,
        examples_frequency: 6, citation_level: rule.citationDefault, image_frequency: 3, narrative_level: style.narrativeSpeed, technical_depth: style.technicalVocabulary
      })
    ]);

    await supabase.from("book_covers").insert({
      book_id: bookId,
      concept: { title: blueprint.selectedTitle, subtitle: blueprint.selectedSubtitle, templateMood: input.templateMood, palette: ["paper","charcoal","accent"] },
      is_selected: true
    });

    for (let partIndex = 0; partIndex < blueprint.parts.length; partIndex++) {
      const partPlan = blueprint.parts[partIndex];
      const { data: part, error: partError } = await supabase.from("parts").insert({
        book_id: bookId, position: partIndex, title: partPlan.title, purpose: partPlan.purpose
      }).select("id").single();
      if (partError) throw partError;

      for (let chapterIndex = 0; chapterIndex < partPlan.chapters.length; chapterIndex++) {
        const chapterPlan = partPlan.chapters[chapterIndex];
        const { data: chapter, error: chapterError } = await supabase.from("chapters").insert({
          book_id: bookId, part_id: part.id, position: chapterIndex, title: chapterPlan.title, goal: chapterPlan.goal,
          target_words: chapterPlan.targetWords, dependencies: chapterPlan.dependencies, status: "PLANNED"
        }).select("id").single();
        if (chapterError) throw chapterError;

        const sectionRows = chapterPlan.sections.map((section, sectionIndex) => ({
          book_id: bookId, chapter_id: chapter.id, position: sectionIndex, title: section.title, goal: section.goal,
          target_words: section.targetWords, research_needed: section.researchNeeded, layout_hint: section.layoutHint, status: "PLANNED"
        }));
        const { error: sectionError } = await supabase.from("sections").insert(sectionRows);
        if (sectionError) throw sectionError;
      }
    }

    if (blueprint.storyBible) await supabase.from("story_bibles").insert({ book_id: bookId, data: blueprint.storyBible, version: 1 });
    if (blueprint.knowledgeMap) await supabase.from("knowledge_maps").insert({ book_id: bookId, data: blueprint.knowledgeMap, version: 1 });

    await supabase.from("token_usage").insert({
      user_id: user.id, book_id: bookId, operation: "BOOK_PLANNER", model: generation.usage.model,
      input_tokens: generation.usage.inputTokens, output_tokens: generation.usage.outputTokens,
      estimated_cost: estimateOpenAICost(generation.usage.model, generation.usage.inputTokens, generation.usage.outputTokens),
      duration_ms: generation.usage.durationMs, retry_count: 0
    });

    return NextResponse.json({ bookId, blueprint });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message === "UNAUTHORIZED" ? 401 : message === "RATE_LIMITED" ? 429 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
