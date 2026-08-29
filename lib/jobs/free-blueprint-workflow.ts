import { FatalError, sleep } from "workflow";
import { createServiceSupabase } from "@/lib/supabase/server";
import {
  backgroundProviderCheckpointPrefix,
  backgroundProviderLabel,
  generateBackgroundStructured,
  normalizeBackgroundProvider,
  type BackgroundAiProvider
} from "@/lib/ai/background-provider";
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
  aiProvider?: BackgroundAiProvider;
};

type WorkflowInput = { bookId: string; userId: string; jobId: string; form: BlueprintForm };
type Usage = { inputTokens: number; outputTokens: number; durationMs: number; model: string; requestId?: string };
type SkeletonResult =
  | { kind: "completed"; skeleton: BookBlueprintSkeleton; usage: Usage; checkpoint: boolean }
  | { kind: "usage-limit" }
  | { kind: "connection-expired" }
  | { kind: "temporary-error"; message: string };
type ChapterResult =
  | { kind: "completed"; plan: ChapterSections; usage: Usage; checkpoint: boolean }
  | { kind: "usage-limit" }
  | { kind: "connection-expired" }
  | { kind: "temporary-error"; message: string };

type ChapterRequest = {
  partIndex: number;
  chapterIndex: number;
  selectedTitle: string;
  coreMessage: string;
  part: BookBlueprintSkeleton["parts"][number];
  chapter: BookBlueprintSkeleton["parts"][number]["chapters"][number];
};

type BlueprintStepRequest =
  | { action: "mark"; input: WorkflowInput; status: string; progress: number; message: string }
  | { action: "skeleton"; input: WorkflowInput }
  | ({ action: "chapter"; input: WorkflowInput } & ChapterRequest)
  | { action: "persist"; input: WorkflowInput; blueprint: BookBlueprint; usages: Usage[] }
  | { action: "finish"; input: WorkflowInput; providerLabel: string }
  | { action: "fail"; input: WorkflowInput; message: string };

type BlueprintStepResult = SkeletonResult | ChapterResult | { kind: "ok" };

export async function generateFreeBlueprintWorkflow(input: WorkflowInput) {
  "use workflow";

  const provider = normalizeBackgroundProvider(input.form.aiProvider);
  const providerLabel = backgroundProviderLabel(provider);
  try {
    await blueprintStep({ action: "mark", input, status: "PLANNING", progress: 8, message: `${providerLabel}로 Book Blueprint를 작은 단계로 나눠 백그라운드 생성을 시작했습니다.` });

    let skeletonResult: Extract<SkeletonResult, { kind: "completed" }> | null = null;
    let skeletonRetries = 0;
    while (!skeletonResult) {
      const result = await blueprintStep({ action: "skeleton", input }) as SkeletonResult;
      if (result.kind === "completed") {
        skeletonResult = result;
        await blueprintStep({
          action: "mark",
          input,
          status: "PLANNING",
          progress: 30,
          message: result.checkpoint ? "저장된 책 구조를 불러왔습니다." : `1단계 책 구조와 Chapter 설계가 완료되었습니다. · ${providerLabel}`
        });
        break;
      }
      if (result.kind === "usage-limit") {
        await blueprintStep({ action: "mark", input, status: "WAITING_LIMIT", progress: 12, message: limitMessage(provider, "Book Blueprint 책 구조 설계") });
        await workflowWait(limitWait(provider));
        await blueprintStep({ action: "mark", input, status: "PLANNING", progress: 14, message: `${providerLabel} 사용 한도 대기 후 저장된 단계에서 자동 재개합니다.` });
        continue;
      }
      if (result.kind === "connection-expired") {
        await blueprintStep({ action: "mark", input, status: "NEEDS_RECONNECT", progress: 12, message: `${providerLabel} 연결이 만료되었습니다. 다시 연결하면 저장된 단계에서 이어집니다.` });
        return { status: "needs-reconnect", bookId: input.bookId };
      }
      if (skeletonRetries < 1) {
        skeletonRetries += 1;
        await blueprintStep({ action: "mark", input, status: "RETRYING", progress: 12, message: "책 구조 응답 형식이 불완전해 2분 뒤 작은 요청으로 한 번 더 시도합니다." });
        await workflowWait("2m");
        continue;
      }
      await blueprintStep({ action: "fail", input, message: result.message });
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
          const result = await blueprintStep({
            action: "chapter",
            input,
            partIndex,
            chapterIndex,
            selectedTitle: skeleton.selectedTitle,
            coreMessage: skeleton.coreMessage,
            part,
            chapter
          }) as ChapterResult;

          if (result.kind === "completed") {
            chapterResult = result;
            if (!result.checkpoint) usage.push(result.usage);
            break;
          }
          if (result.kind === "usage-limit") {
            const progress = planningProgress(completedChapters, totalChapters);
            await blueprintStep({ action: "mark", input, status: "WAITING_LIMIT", progress, message: limitMessage(provider, `Chapter ${completedChapters + 1}/${totalChapters} 설계`) });
            await workflowWait(limitWait(provider));
            await blueprintStep({ action: "mark", input, status: "PLANNING", progress, message: `${providerLabel} 사용 한도 대기 후 다음 Chapter 설계를 재개합니다.` });
            continue;
          }
          if (result.kind === "connection-expired") {
            await blueprintStep({ action: "mark", input, status: "NEEDS_RECONNECT", progress: planningProgress(completedChapters, totalChapters), message: `${providerLabel} 연결이 만료되었습니다. 다시 연결하면 완료된 Chapter 다음부터 이어집니다.` });
            return { status: "needs-reconnect", bookId: input.bookId };
          }
          if (chapterRetries < 1) {
            chapterRetries += 1;
            await blueprintStep({ action: "mark", input, status: "RETRYING", progress: planningProgress(completedChapters, totalChapters), message: `Chapter ${completedChapters + 1}/${totalChapters} 응답이 불완전해 2분 뒤 해당 Chapter만 다시 시도합니다.` });
            await workflowWait("2m");
            continue;
          }
          await blueprintStep({ action: "fail", input, message: result.message });
          return { status: "paused-error", bookId: input.bookId, error: result.message };
        }

        chapters.push({ ...chapter, sections: chapterResult.plan.sections });
        completedChapters += 1;
        await blueprintStep({
          action: "mark",
          input,
          status: "PLANNING",
          progress: planningProgress(completedChapters, totalChapters),
          message: `${completedChapters}/${totalChapters} Chapter 세부 목차 완료${chapterResult.checkpoint ? " · 저장본 복원" : ` · ${providerLabel}`}`
        });
      }
      parts.push({ ...part, chapters });
    }

    const blueprint = BookBlueprintSchema.parse({ ...skeleton, parts });
    await blueprintStep({ action: "persist", input, blueprint, usages: usage });
    await blueprintStep({ action: "finish", input, providerLabel });
    return { status: "completed", bookId: input.bookId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await blueprintStep({ action: "fail", input, message });
    throw error;
  }
}

async function workflowWait(duration: string) {
  await sleep(duration);
}

function providerOf(input: WorkflowInput) {
  return normalizeBackgroundProvider(input.form.aiProvider);
}

function planningProgress(completed: number, total: number) {
  if (total <= 0) return 85;
  return Math.min(88, 30 + (completed / total) * 58);
}

function limitWait(provider: BackgroundAiProvider) {
  return provider === "codex" ? "1h" : "24h";
}

function limitMessage(provider: BackgroundAiProvider, stage: string) {
  return provider === "codex"
    ? `${stage} 중 ChatGPT/Codex 사용 한도에 도달했습니다. 완료된 단계는 저장되어 있으며 1시간 뒤 자동 확인합니다.`
    : `${stage} 중 OpenRouter 무료 일일 한도에 도달했습니다. 완료된 단계는 저장되어 있으며 24시간 뒤 자동 재개합니다.`;
}

function classifyFailure(message: string): Exclude<SkeletonResult, { kind: "completed" }> {
  if (message === "FREE_AI_DAILY_LIMIT" || message === "CODEX_USAGE_LIMIT") return { kind: "usage-limit" };
  if (
    message === "FREE_AI_CONNECTION_EXPIRED" ||
    message === "FREE_AI_CONNECTION_REQUIRED" ||
    message === "CODEX_CONNECTION_EXPIRED" ||
    message === "CODEX_CONNECTION_REQUIRED"
  ) return { kind: "connection-expired" };
  return { kind: "temporary-error", message };
}

function skeletonStepType(provider: BackgroundAiProvider) {
  return `${backgroundProviderCheckpointPrefix(provider)}_BLUEPRINT_SKELETON_V3`;
}

function chapterStepType(provider: BackgroundAiProvider, partIndex: number, chapterIndex: number) {
  return `${backgroundProviderCheckpointPrefix(provider)}_BLUEPRINT_CHAPTER_V3:${partIndex}:${chapterIndex}`;
}

async function blueprintStep(request: BlueprintStepRequest): Promise<BlueprintStepResult> {
  "use step";

  switch (request.action) {
    case "mark":
      await markPlanning(request.input, request.status, request.progress, request.message);
      return { kind: "ok" };
    case "skeleton":
      return generateBlueprintSkeleton(request.input);
    case "chapter":
      return generateChapterSections(request.input, request);
    case "persist":
      await persistBlueprint(request.input, request.blueprint, request.usages);
      return { kind: "ok" };
    case "finish":
      await finishPlanning(request.input, request.providerLabel);
      return { kind: "ok" };
    case "fail":
      await failPlanning(request.input, request.message);
      return { kind: "ok" };
  }
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

async function generateBlueprintSkeleton(input: WorkflowInput): Promise<SkeletonResult> {
  const provider = providerOf(input);
  const stepType = skeletonStepType(provider);
  const checkpoint = await loadCheckpoint(input.bookId, stepType, (value) => BookBlueprintSkeletonSchema.parse(value));
  if (checkpoint) {
    return { kind: "completed", skeleton: checkpoint, usage: { inputTokens: 0, outputTokens: 0, durationMs: 0, model: "checkpoint" }, checkpoint: true };
  }

  try {
    const generation = await generateBackgroundStructured(provider, input.userId, {
      schemaName: "blueprint_skeleton",
      jsonSchema: bookBlueprintSkeletonJsonSchema as unknown as Record<string, unknown>,
      system: plannerSystem(),
      prompt: plannerSkeletonPrompt(input.form),
      parse: (value) => BookBlueprintSkeletonSchema.parse(value)
    });
    await saveCheckpoint(input, stepType, generation.value, generation.usage);
    return { kind: "completed", skeleton: generation.value, usage: generation.usage, checkpoint: false };
  } catch (error) {
    return classifyFailure(error instanceof Error ? error.message : "AI_BLUEPRINT_FAILED");
  }
}

async function generateChapterSections(input: WorkflowInput, request: ChapterRequest): Promise<ChapterResult> {
  const provider = providerOf(input);
  const stepType = chapterStepType(provider, request.partIndex, request.chapterIndex);
  const checkpoint = await loadCheckpoint(input.bookId, stepType, (value) => ChapterSectionsSchema.parse(value));
  if (checkpoint) {
    return { kind: "completed", plan: checkpoint, usage: { inputTokens: 0, outputTokens: 0, durationMs: 0, model: "checkpoint" }, checkpoint: true };
  }

  try {
    const rule = getBookTypeRule(input.form.bookType);
    const generation = await generateBackgroundStructured(provider, input.userId, {
      schemaName: "chapter_sections",
      jsonSchema: chapterSectionsJsonSchema as unknown as Record<string, unknown>,
      system: plannerSystem(),
      prompt: chapterSectionsPrompt({
        form: input.form,
        selectedTitle: request.selectedTitle,
        coreMessage: request.coreMessage,
        partTitle: request.part.title,
        partPurpose: request.part.purpose,
        chapterTitle: request.chapter.title,
        chapterGoal: request.chapter.goal,
        chapterTargetWords: request.chapter.targetWords,
        preferredSectionMin: rule.sectionRange[0],
        preferredSectionMax: rule.sectionRange[1]
      }),
      parse: (value) => ChapterSectionsSchema.parse(value)
    });
    await saveCheckpoint(input, stepType, generation.value, generation.usage);
    return { kind: "completed", plan: generation.value, usage: generation.usage, checkpoint: false };
  } catch (error) {
    return classifyFailure(error instanceof Error ? error.message : "AI_BLUEPRINT_FAILED");
  }
}

async function persistBlueprint(input: WorkflowInput, blueprint: BookBlueprint, usages: Usage[]) {
  const supabase = createServiceSupabase();
  const provider = providerOf(input);

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
  const modelLabel = [...new Set(aggregate.models)].join(", ").slice(0, 240) || `${backgroundProviderCheckpointPrefix(provider).toLowerCase()}-checkpoint`;

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
      operation: provider === "codex" ? "CODEX_LUNA_BOOK_PLANNER_BACKGROUND_SPLIT" : "FREE_BOOK_PLANNER_BACKGROUND_SPLIT",
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
  const supabase = createServiceSupabase();
  await Promise.all([
    supabase.from("generation_jobs").update({ status, progress, updated_at: new Date().toISOString() }).eq("id", input.jobId),
    supabase.from("job_logs").insert({ generation_job_id: input.jobId, level: status === "WAITING_LIMIT" ? "warning" : "info", message })
  ]);
}

async function finishPlanning(input: WorkflowInput, providerLabel: string) {
  const supabase = createServiceSupabase();
  await Promise.all([
    supabase.from("generation_jobs").update({ status: "COMPLETED", progress: 100, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", input.jobId),
    supabase.from("job_logs").insert({ generation_job_id: input.jobId, level: "info", message: `Book Blueprint와 전체 목차 생성이 완료되었습니다. · ${providerLabel}` })
  ]);
}

async function failPlanning(input: WorkflowInput, message: string) {
  const supabase = createServiceSupabase();
  await Promise.all([
    supabase.from("books").update({ status: "FAILED", updated_at: new Date().toISOString() }).eq("id", input.bookId),
    supabase.from("generation_jobs").update({ status: "PAUSED_ERROR", failure_reason: message, updated_at: new Date().toISOString() }).eq("id", input.jobId),
    supabase.from("job_logs").insert({ generation_job_id: input.jobId, level: "error", message: `Book Blueprint 백그라운드 생성 실패: ${message}` })
  ]);
}
