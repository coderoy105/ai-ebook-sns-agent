import { FatalError, sleep } from "workflow";
import { createServiceSupabase } from "@/lib/supabase/server";
import { OpenRouterFreeProvider } from "@/lib/ai/openrouter-free";
import {
  BookBlueprintSchema,
  BookBlueprintSkeletonSchema,
  ChapterSectionsSchema,
  type BookBlueprint,
  type BookBlueprintSkeleton,
  type ChapterSections
} from "@/lib/ai/schemas";
import { bookBlueprintSkeletonJsonSchema, chapterSectionsJsonSchema } from "@/lib/ai/json-schemas";
import { chapterSectionsPrompt, plannerSkeletonPrompt, plannerSystem } from "@/lib/ai/prompts";
import { getBookTypeRule } from "@/lib/book-types/engine";

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
type Usage = { inputTokens: number; outputTokens: number; durationMs: number; model: string; requestId?: string };
type SkeletonResult =
  | { kind: "completed"; skeleton: BookBlueprintSkeleton; usage: Usage; checkpoint: boolean }
  | { kind: "daily-limit" }
  | { kind: "connection-expired" }
  | { kind: "temporary-error"; message: string };
type ChapterResult =
  | { kind: "completed"; plan: ChapterSections; usage: Usage; checkpoint: boolean }
  | { kind: "daily-limit" }
  | { kind: "connection-expired" }
  | { kind: "temporary-error"; message: string };

const SKELETON_STEP = "FREE_BLUEPRINT_SKELETON_V2";
const CHAPTER_STEP_PREFIX = "FREE_BLUEPRINT_CHAPTER_V2";

export async function generateFreeBlueprintWorkflow(input: WorkflowInput) {
  "use workflow";

  try {
    await markPlanning(input, "PLANNING", 8, "Book Blueprint를 작은 단계로 나눠 백그라운드 생성을 시작했습니다.");

    let skeletonResult: Extract<SkeletonResult, { kind: "completed" }> | null = null;
    let skeletonRetries = 0;
    while (!skeletonResult) {
      const result = await generateBlueprintSkeletonStep(input);
      if (result.kind === "completed") {
        skeletonResult = result;
        await markPlanning(
          input,
          "PLANNING",
          30,
          result.checkpoint ? "저장된 책 구조를 불러왔습니다." : "1단계 책 구조와 Chapter 설계가 완료되었습니다."
        );
        break;
      }
      if (result.kind === "daily-limit") {
        await markPlanning(input, "WAITING_LIMIT", 12, "무료 일일 한도에 도달했습니다. 저장된 단계에서 24시간 뒤 자동 재개합니다.");
        await sleep("24h");
        await markPlanning(input, "PLANNING", 14, "무료 한도 대기 후 Book Blueprint 생성을 자동 재개합니다.");
        continue;
      }
      if (result.kind === "connection-expired") {
        await markPlanning(input, "NEEDS_RECONNECT", 12, "무료 AI 연결이 만료되었습니다. 다시 연결하면 저장된 단계에서 이어집니다.");
        return { status: "needs-reconnect", bookId: input.bookId };
      }
      if (skeletonRetries < 1) {
        skeletonRetries += 1;
        await markPlanning(input, "RETRYING", 12, "책 구조 응답 형식이 불완전해 2분 뒤 작은 요청으로 한 번 더 시도합니다.");
        await sleep("2m");
        continue;
      }
      await failPlanning(input, result.message);
      return { status: "paused-error", bookId: input.bookId, error: result.message };
    }

    const skeleton = skeletonResult.skeleton;
    const usage: Usage[] = skeletonResult.checkpoint ? [] : [skeletonResult.usage];
    const totalChapters = skeleton.parts.reduce((sum, part) => sum + part.chapters.length, 0);
    let completedChapters = 0;
    const parts: BookBlueprint["parts"] = [];

    for (let partIndex = 0; partIndex < skeleton.parts.length; partIndex++) {
      const part = skeleton.parts[partIndex];
      const chapters: BookBlueprint["parts"][number]["chapters"] = [];

      for (let chapterIndex = 0; chapterIndex < part.chapters.length; chapterIndex++) {
        const chapter = part.chapters[chapterIndex];
        let chapterResult: Extract<ChapterResult, { kind: "completed" }> | null = null;
        let chapterRetries = 0;

        while (!chapterResult) {
          const result = await generateChapterSectionsStep({
            ...input,
            partIndex,
            chapterIndex,
            selectedTitle: skeleton.selectedTitle,
            coreMessage: skeleton.coreMessage,
            part,
            chapter
          });

          if (result.kind === "completed") {
            chapterResult = result;
            if (!result.checkpoint) usage.push(result.usage);
            break;
          }
          if (result.kind === "daily-limit") {
            const progress = planningProgress(completedChapters, totalChapters);
            await markPlanning(input, "WAITING_LIMIT", progress, `Chapter ${completedChapters + 1}/${totalChapters} 설계 중 무료 한도에 도달했습니다. 저장된 단계에서 24시간 뒤 이어집니다.`);
            await sleep("24h");
            await markPlanning(input, "PLANNING", progress, "무료 한도 대기 후 다음 Chapter 설계를 재개합니다.");
            continue;
          }
          if (result.kind === "connection-expired") {
            await markPlanning(input, "NEEDS_RECONNECT", planningProgress(completedChapters, totalChapters), "무료 AI 연결이 만료되었습니다. 다시 연결하면 완료된 Chapter 다음부터 이어집니다.");
            return { status: "needs-reconnect", bookId: input.bookId };
          }
          if (chapterRetries < 1) {
            chapterRetries += 1;
            await markPlanning(input, "RETRYING", planningProgress(completedChapters, totalChapters), `Chapter ${completedChapters + 1}/${totalChapters} JSON이 불완전해 2분 뒤 해당 Chapter만 다시 시도합니다.`);
            await sleep("2m");
            continue;
          }
          await failPlanning(input, result.message);
          return { status: "paused-error", bookId: input.bookId, error: result.message };
        }

        chapters.push({ ...chapter, sections: chapterResult.plan.sections });
        completedChapters += 1;
        await markPlanning(
          input,
          "PLANNING",
          planningProgress(completedChapters, totalChapters),
          `${completedChapters}/${totalChapters} Chapter 세부 목차 완료${chapterResult.checkpoint ? " · 저장본 복원" : ""}`
        );
      }
      parts.push({ ...part, chapters });
    }

    const blueprint = BookBlueprintSchema.parse({ ...skeleton, parts });
    await persistBlueprintStep(input, blueprint, usage);
    await finishPlanning(input);
    return { status: "completed", bookId: input.bookId };
  } catch (error) {
    await failPlanning(input, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

function planningProgress(completed: number, total: number) {
  if (total <= 0) return 85;
  return Math.min(88, 30 + (completed / total) * 58);
}

async function loadOpenRouterKey(userId: string) {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase.rpc<string | null>("get_openrouter_credential", { p_user_id: userId });
  if (error) throw new Error(error.message);
  return typeof data === "string" ? data : null;
}

function classifyFailure(message: string): Exclude<SkeletonResult, { kind: "completed" }> {
  if (message === "FREE_AI_DAILY_LIMIT") return { kind: "daily-limit" };
  if (message === "FREE_AI_CONNECTION_EXPIRED" || message === "FREE_AI_CONNECTION_REQUIRED") return { kind: "connection-expired" };
  return { kind: "temporary-error", message };
}

async function loadCheckpoint<T>(bookId: string, stepType: string, parse: (value: unknown) => T): Promise<T | null> {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase.from("generation_steps")
    .select("output")
    .eq("book_id", bookId)
    .eq("step_type", stepType)
    .eq("status", "COMPLETED")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.output) return null;
  try { return parse(data.output); }
  catch { return null; }
}

async function saveCheckpoint(input: WorkflowInput, stepType: string, output: unknown, usage: Usage) {
  const supabase = createServiceSupabase();
  const now = new Date().toISOString();
  const { error } = await supabase.from("generation_steps").insert({
    generation_job_id: input.jobId,
    book_id: input.bookId,
    step_type: stepType,
    status: "COMPLETED",
    output,
    duration_ms: usage.durationMs,
    started_at: now,
    finished_at: now
  });
  if (error) throw new FatalError(error.message);
}

async function generateBlueprintSkeletonStep(input: WorkflowInput): Promise<SkeletonResult> {
  "use step";
  const checkpoint = await loadCheckpoint(input.bookId, SKELETON_STEP, (value) => BookBlueprintSkeletonSchema.parse(value));
  if (checkpoint) {
    return { kind: "completed", skeleton: checkpoint, usage: { inputTokens: 0, outputTokens: 0, durationMs: 0, model: "checkpoint" }, checkpoint: true };
  }

  const key = await loadOpenRouterKey(input.userId);
  if (!key) return { kind: "connection-expired" };

  try {
    const provider = new OpenRouterFreeProvider(key);
    const generation = await provider.generateStructured({
      model: "openrouter/free",
      schemaName: "blueprint_skeleton",
      jsonSchema: bookBlueprintSkeletonJsonSchema as unknown as Record<string, unknown>,
      system: plannerSystem(),
      prompt: plannerSkeletonPrompt(input.form),
      parse: (value) => BookBlueprintSkeletonSchema.parse(value)
    });
    await saveCheckpoint(input, SKELETON_STEP, generation.value, generation.usage);
    return { kind: "completed", skeleton: generation.value, usage: generation.usage, checkpoint: false };
  } catch (error) {
    return classifyFailure(error instanceof Error ? error.message : "FREE_AI_FAILED");
  }
}

async function generateChapterSectionsStep(input: WorkflowInput & {
  partIndex: number;
  chapterIndex: number;
  selectedTitle: string;
  coreMessage: string;
  part: BookBlueprintSkeleton["parts"][number];
  chapter: BookBlueprintSkeleton["parts"][number]["chapters"][number];
}): Promise<ChapterResult> {
  "use step";
  const stepType = `${CHAPTER_STEP_PREFIX}:${input.partIndex}:${input.chapterIndex}`;
  const checkpoint = await loadCheckpoint(input.bookId, stepType, (value) => ChapterSectionsSchema.parse(value));
  if (checkpoint) {
    return { kind: "completed", plan: checkpoint, usage: { inputTokens: 0, outputTokens: 0, durationMs: 0, model: "checkpoint" }, checkpoint: true };
  }

  const key = await loadOpenRouterKey(input.userId);
  if (!key) return { kind: "connection-expired" };

  try {
    const rule = getBookTypeRule(input.form.bookType);
    const provider = new OpenRouterFreeProvider(key);
    const generation = await provider.generateStructured({
      model: "openrouter/free",
      schemaName: "chapter_sections",
      jsonSchema: chapterSectionsJsonSchema as unknown as Record<string, unknown>,
      system: plannerSystem(),
      prompt: chapterSectionsPrompt({
        form: input.form,
        selectedTitle: input.selectedTitle,
        coreMessage: input.coreMessage,
        partTitle: input.part.title,
        partPurpose: input.part.purpose,
        chapterTitle: input.chapter.title,
        chapterGoal: input.chapter.goal,
        chapterTargetWords: input.chapter.targetWords,
        preferredSectionMin: rule.sectionRange[0],
        preferredSectionMax: rule.sectionRange[1]
      }),
      parse: (value) => ChapterSectionsSchema.parse(value)
    });
    await saveCheckpoint(input, stepType, generation.value, generation.usage);
    return { kind: "completed", plan: generation.value, usage: generation.usage, checkpoint: false };
  } catch (error) {
    const classified = classifyFailure(error instanceof Error ? error.message : "FREE_AI_FAILED");
    return classified.kind === "temporary-error" ? classified : classified;
  }
}

async function persistBlueprintStep(input: WorkflowInput, blueprint: BookBlueprint, usages: Usage[]) {
  "use step";
  const supabase = createServiceSupabase();

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
        research_needed: section.researchNeeded,
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

  const aggregate = usages.reduce((acc, item) => ({
    inputTokens: acc.inputTokens + item.inputTokens,
    outputTokens: acc.outputTokens + item.outputTokens,
    durationMs: acc.durationMs + item.durationMs,
    models: item.model && item.model !== "checkpoint" ? [...acc.models, item.model] : acc.models
  }), { inputTokens: 0, outputTokens: 0, durationMs: 0, models: [] as string[] });
  const modelLabel = [...new Set(aggregate.models)].join(", ").slice(0, 240) || "free-ai-checkpoint";

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
      operation: "FREE_BOOK_PLANNER_BACKGROUND_SPLIT",
      model: modelLabel,
      input_tokens: aggregate.inputTokens,
      output_tokens: aggregate.outputTokens,
      estimated_cost: 0,
      duration_ms: aggregate.durationMs,
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
    supabase.from("generation_jobs").update({ status: "PAUSED_ERROR", failure_reason: message, updated_at: new Date().toISOString() }).eq("id", input.jobId),
    supabase.from("job_logs").insert({ generation_job_id: input.jobId, level: "error", message: `Book Blueprint 백그라운드 생성 실패: ${message}` })
  ]);
}
