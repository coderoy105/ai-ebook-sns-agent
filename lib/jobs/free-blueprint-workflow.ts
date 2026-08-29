import { FatalError, sleep } from "workflow";
import { createServiceSupabase } from "@/lib/supabase/server";
import { OpenRouterFreeProvider } from "@/lib/ai/openrouter-free";
import { BookBlueprintSchema, type BookBlueprint } from "@/lib/ai/schemas";
import { bookBlueprintJsonSchema } from "@/lib/ai/json-schemas";
import { plannerPrompt, plannerSystem } from "@/lib/ai/prompts";

type BlueprintForm = {
  idea: string;
  bookType: string;
  audience: string;
  ageGroup: string;
  knowledgeLevel: "beginner" | "intermediate" | "advanced" | "expert";
  tone: string;
  targetPages: number;
  targetWords: number;
  templateMood: string;
  mode: "quick" | "advanced";
};

type WorkflowInput = { bookId: string; userId: string; jobId: string; form: BlueprintForm };
type BlueprintResult =
  | { kind: "completed"; blueprint: BookBlueprint; usage: { inputTokens: number; outputTokens: number; durationMs: number; model: string; requestId?: string } }
  | { kind: "daily-limit" }
  | { kind: "connection-expired" }
  | { kind: "temporary-error"; message: string };

export async function generateFreeBlueprintWorkflow(input: WorkflowInput) {
  "use workflow";

  try {
    await markPlanning(input, "PLANNING", 12, "Book Blueprint 백그라운드 생성을 시작했습니다.");
    let transientRetry = 0;

    while (true) {
      const result = await generateBlueprintStep(input);
      if (result.kind === "completed") {
        await persistBlueprintStep(input, result.blueprint, result.usage);
        await finishPlanning(input);
        return { status: "completed", bookId: input.bookId };
      }

      if (result.kind === "daily-limit") {
        await markPlanning(input, "WAITING_LIMIT", 32, "무료 일일 한도에 도달했습니다. 프로젝트는 저장되어 있고 24시간 뒤 자동으로 기획을 재개합니다.");
        await sleep("24h");
        await markPlanning(input, "PLANNING", 35, "무료 한도 대기 후 Book Blueprint 생성을 자동 재개합니다.");
        continue;
      }

      if (result.kind === "connection-expired") {
        await markPlanning(input, "NEEDS_RECONNECT", 25, "무료 AI 연결이 만료되었습니다. 다시 연결하면 저장된 프로젝트에서 기획을 이어갈 수 있습니다.");
        return { status: "needs-reconnect", bookId: input.bookId };
      }

      if (transientRetry < 1) {
        transientRetry += 1;
        await markPlanning(input, "RETRYING", 28, "무료 AI 제공자가 혼잡합니다. 저장된 상태로 잠시 뒤 자동 재시도합니다.");
        await sleep("10m");
        continue;
      }

      await failPlanning(input, result.message);
      return { status: "paused-error", bookId: input.bookId, error: result.message };
    }
  } catch (error) {
    await failPlanning(input, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function loadOpenRouterKey(userId: string) {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase.rpc<string | null>("get_openrouter_credential", { p_user_id: userId });
  if (error) throw new Error(error.message);
  return typeof data === "string" ? data : null;
}

async function generateBlueprintStep(input: WorkflowInput): Promise<BlueprintResult> {
  "use step";
  const key = await loadOpenRouterKey(input.userId);
  if (!key) return { kind: "connection-expired" };

  try {
    const provider = new OpenRouterFreeProvider(key);
    const generation = await provider.generateStructured({
      model: "openrouter/free",
      schemaName: "book_blueprint",
      jsonSchema: bookBlueprintJsonSchema as unknown as Record<string, unknown>,
      system: plannerSystem(),
      prompt: `${plannerPrompt(input.form)}\n\nFREE MODE: Prefer a compact, practical outline that can be generated one section at a time. Combine redundant sections. Do not claim that web research or live citations were performed. Keep the blueprint concise enough for a free model to finish reliably.`,
      parse: (value) => BookBlueprintSchema.parse(value)
    });
    return { kind: "completed", blueprint: generation.value, usage: generation.usage };
  } catch (error) {
    const message = error instanceof Error ? error.message : "FREE_AI_FAILED";
    if (message === "FREE_AI_DAILY_LIMIT") return { kind: "daily-limit" };
    if (message === "FREE_AI_CONNECTION_EXPIRED" || message === "FREE_AI_CONNECTION_REQUIRED") return { kind: "connection-expired" };
    return { kind: "temporary-error", message };
  }
}

async function persistBlueprintStep(
  input: WorkflowInput,
  blueprint: BookBlueprint,
  usage: { inputTokens: number; outputTokens: number; durationMs: number; model: string; requestId?: string }
) {
  "use step";
  const supabase = createServiceSupabase();

  // Planning persistence is intentionally idempotent. A retried step resets only
  // generated outline data; no manuscript prose exists at this stage.
  await supabase.from("parts").delete().eq("book_id", input.bookId);
  await supabase.from("book_blueprints").delete().eq("book_id", input.bookId);
  await supabase.from("book_covers").delete().eq("book_id", input.bookId);
  await supabase.from("story_bibles").delete().eq("book_id", input.bookId);
  await supabase.from("knowledge_maps").delete().eq("book_id", input.bookId);

  const { error: blueprintError } = await supabase.from("book_blueprints").insert({
    book_id: input.bookId,
    blueprint,
    version: 1,
    is_active: true
  });
  if (blueprintError) throw new FatalError(blueprintError.message);

  const { error: coverError } = await supabase.from("book_covers").insert({
    book_id: input.bookId,
    concept: {
      title: blueprint.selectedTitle,
      subtitle: blueprint.selectedSubtitle,
      templateMood: input.form.templateMood,
      palette: ["paper", "charcoal", "accent"]
    },
    is_selected: true
  });
  if (coverError) throw new FatalError(coverError.message);

  let chapterCount = 0;
  for (let partIndex = 0; partIndex < blueprint.parts.length; partIndex++) {
    const partPlan = blueprint.parts[partIndex];
    const { data: part, error: partError } = await supabase.from("parts").insert({
      book_id: input.bookId,
      position: partIndex,
      title: partPlan.title,
      purpose: partPlan.purpose
    }).select("id").single();
    if (partError || !part) throw new FatalError(partError?.message ?? "PART_CREATE_FAILED");

    for (let chapterIndex = 0; chapterIndex < partPlan.chapters.length; chapterIndex++) {
      chapterCount += 1;
      const chapterPlan = partPlan.chapters[chapterIndex];
      const { data: chapter, error: chapterError } = await supabase.from("chapters").insert({
        book_id: input.bookId,
        part_id: part.id,
        position: chapterIndex,
        title: chapterPlan.title,
        goal: chapterPlan.goal,
        target_words: chapterPlan.targetWords,
        dependencies: chapterPlan.dependencies,
        status: "PLANNED"
      }).select("id").single();
      if (chapterError || !chapter) throw new FatalError(chapterError?.message ?? "CHAPTER_CREATE_FAILED");

      const sectionRows = chapterPlan.sections.map((section, sectionIndex) => ({
        book_id: input.bookId,
        chapter_id: chapter.id,
        position: sectionIndex,
        title: section.title,
        goal: section.goal,
        target_words: section.targetWords,
        research_needed: false,
        layout_hint: section.layoutHint,
        status: "PLANNED"
      }));
      const { error: sectionError } = await supabase.from("sections").insert(sectionRows);
      if (sectionError) throw new FatalError(sectionError.message);
    }
  }

  if (blueprint.storyBible) {
    const { error } = await supabase.from("story_bibles").insert({ book_id: input.bookId, data: blueprint.storyBible, version: 1 });
    if (error) throw new FatalError(error.message);
  }
  if (blueprint.knowledgeMap) {
    const { error } = await supabase.from("knowledge_maps").insert({ book_id: input.bookId, data: blueprint.knowledgeMap, version: 1 });
    if (error) throw new FatalError(error.message);
  }

  const updates = await Promise.all([
    supabase.from("books").update({
      title: blueprint.selectedTitle,
      subtitle: blueprint.selectedSubtitle,
      status: "DRAFT",
      progress: 0,
      updated_at: new Date().toISOString()
    }).eq("id", input.bookId),
    supabase.from("book_settings").update({ chapter_count: chapterCount }).eq("book_id", input.bookId),
    supabase.from("token_usage").insert({
      user_id: input.userId,
      book_id: input.bookId,
      operation: "FREE_BOOK_PLANNER_BACKGROUND",
      model: usage.model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      estimated_cost: 0,
      duration_ms: usage.durationMs,
      retry_count: 0
    })
  ]);
  const updateError = updates.find((result) => result.error)?.error;
  if (updateError) throw new FatalError(updateError.message);
}

async function markPlanning(input: WorkflowInput, status: string, progress: number, message: string) {
  "use step";
  const supabase = createServiceSupabase();
  await Promise.all([
    supabase.from("generation_jobs").update({ status, progress, updated_at: new Date().toISOString() }).eq("id", input.jobId),
    supabase.from("job_logs").insert({ generation_job_id: input.jobId, level: status === "WAITING_LIMIT" ? "warning" : "info", message })
  ]);
}

async function finishPlanning(input: WorkflowInput) {
  "use step";
  const supabase = createServiceSupabase();
  await Promise.all([
    supabase.from("generation_jobs").update({ status: "COMPLETED", progress: 100, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", input.jobId),
    supabase.from("job_logs").insert({ generation_job_id: input.jobId, level: "info", message: "Book Blueprint와 전체 목차 생성이 완료되었습니다." })
  ]);
}

async function failPlanning(input: WorkflowInput, message: string) {
  "use step";
  const supabase = createServiceSupabase();
  await Promise.all([
    supabase.from("books").update({ status: "FAILED", updated_at: new Date().toISOString() }).eq("id", input.bookId),
    supabase.from("generation_jobs").update({ status: "PAUSED_ERROR", updated_at: new Date().toISOString() }).eq("id", input.jobId),
    supabase.from("job_logs").insert({ generation_job_id: input.jobId, level: "error", message: `Book Blueprint 백그라운드 생성 실패: ${message}` })
  ]);
}
