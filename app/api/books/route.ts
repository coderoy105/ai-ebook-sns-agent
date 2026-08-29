import { NextResponse } from "next/server";
import { z } from "zod";
import { start } from "workflow/api";
import { createServiceSupabase, requireUser } from "@/lib/supabase/server";
import { computeWordBudget, getBookTypeRule } from "@/lib/book-types/engine";
import { ReaderProfileSchema, WritingStyleSchema } from "@/lib/ai/schemas";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { generateFreeBlueprintWorkflow } from "@/lib/jobs/free-blueprint-workflow";

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

function temporaryTitle(idea: string) {
  const compact = idea.replace(/\s+/g, " ").trim();
  return compact.length > 64 ? `${compact.slice(0, 61)}…` : compact;
}

export async function POST(request: Request) {
  let createdBookId: string | null = null;
  try {
    const { supabase, user } = await requireUser();
    const input = CreateBookSchema.parse(await request.json());
    await assertRateLimit(user.id, "book-create", 8, 3600);

    const targetWords = computeWordBudget(input.targetPages, input.bookType);
    const reader = inferReaderProfile(input);
    const style = inferWritingStyle(input);
    const rule = getBookTypeRule(input.bookType);
    const service = createServiceSupabase();

    const requestKey = request.headers.get("x-openrouter-key")?.trim();
    if (requestKey && requestKey.length >= 16) {
      const { error: saveError } = await service.rpc("store_openrouter_credential", { p_user_id: user.id, p_secret: requestKey });
      if (saveError) throw new Error(saveError.message);
    }
    const { data: hasCredential, error: credentialError } = await service.rpc<boolean>("has_openrouter_credential", { p_user_id: user.id });
    if (credentialError) throw new Error(credentialError.message);
    if (hasCredential !== true) {
      return NextResponse.json({ error: "FREE_AI_CONNECTION_REQUIRED", reconnect: true }, { status: 428 });
    }

    const { data: book, error: bookError } = await supabase.from("books").insert({
      user_id: user.id,
      title: temporaryTitle(input.idea),
      subtitle: "Book Blueprint 생성 중",
      idea: input.idea,
      book_type: input.bookType,
      book_family: rule.family,
      status: "PLANNING",
      target_pages: input.targetPages,
      target_words: targetWords,
      progress: 0,
      quality_scores: {}
    }).select("id").single();
    if (bookError || !book) throw bookError ?? new Error("BOOK_CREATE_FAILED");
    createdBookId = book.id;

    const setupResults = await Promise.all([
      supabase.from("reader_profiles").insert({
        book_id: book.id,
        age_group: reader.ageGroup,
        knowledge_level: reader.knowledgeLevel,
        reading_purpose: reader.readingPurpose,
        preferred_complexity: reader.preferredComplexity,
        tone_preference: reader.tonePreference,
        technical_tolerance: reader.technicalTolerance,
        example_preference: reader.examplePreference,
        reading_speed: reader.readingSpeed
      }),
      supabase.from("writing_styles").insert({
        book_id: book.id,
        label: style.label,
        description: style.description,
        sentence_length: style.sentenceLength,
        description_depth: style.descriptionDepth,
        emotion_level: style.emotionLevel,
        technical_vocabulary: style.technicalVocabulary,
        dialogue_ratio: style.dialogueRatio,
        narrative_speed: style.narrativeSpeed
      }),
      supabase.from("book_settings").insert({
        book_id: book.id,
        target_pages: input.targetPages,
        target_words: targetWords,
        template_id: input.templateMood.toLowerCase().replace(/\s+/g, "-"),
        chapter_count: null,
        creativity: 6,
        research_depth: 2,
        writing_density: 6,
        sentence_length: style.sentenceLength,
        vocabulary_level: style.technicalVocabulary,
        examples_frequency: 6,
        citation_level: "none",
        image_frequency: 3,
        narrative_level: style.narrativeSpeed,
        technical_depth: style.technicalVocabulary
      })
    ]);
    const setupError = setupResults.find((result) => result.error)?.error;
    if (setupError) throw setupError;

    const { data: job, error: jobError } = await supabase.from("generation_jobs").insert({
      book_id: book.id,
      user_id: user.id,
      status: "QUEUED",
      progress: 5,
      started_at: new Date().toISOString()
    }).select("id").single();
    if (jobError || !job) throw jobError ?? new Error("PLANNING_JOB_CREATE_FAILED");

    const run = await start(generateFreeBlueprintWorkflow, [{
      bookId: book.id,
      userId: user.id,
      jobId: job.id,
      form: { ...input, targetWords }
    }]);

    await Promise.all([
      supabase.from("generation_jobs").update({ workflow_run_id: run.runId, status: "PLANNING", progress: 8 }).eq("id", job.id),
      supabase.from("job_logs").insert({ generation_job_id: job.id, level: "info", message: "Book Blueprint가 백그라운드 작업으로 등록되었습니다. 화면을 나가도 계속 진행됩니다." })
    ]);

    return NextResponse.json({
      bookId: book.id,
      jobId: job.id,
      runId: run.runId,
      background: true,
      planning: true,
      aiMode: "free"
    }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (createdBookId) {
      try {
        const { supabase } = await requireUser();
        await supabase.from("books").update({ status: "FAILED" }).eq("id", createdBookId);
      } catch { /* best-effort failure marker */ }
    }
    const status = message === "UNAUTHORIZED" ? 401 : message === "RATE_LIMITED" ? 429 : 400;
    return NextResponse.json({ error: message, bookId: createdBookId }, { status });
  }
}
