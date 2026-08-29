import { FatalError, sleep } from "workflow";
import { createServiceSupabase } from "@/lib/supabase/server";
import { OpenRouterFreeProvider } from "@/lib/ai/openrouter-free";
import { sectionDraftJsonSchema } from "@/lib/ai/json-schemas";
import { SectionDraftSchema } from "@/lib/ai/schemas";
import { sectionWriterPrompt, sectionWriterSystem } from "@/lib/ai/prompts";
import { composeBookPages } from "@/lib/design/compose";

type WorkflowInput = { bookId: string; userId: string; jobId: string };
type Relation<T> = T | T[] | null;
type OutlineRow = {
  id: string;
  position: number;
  status: string;
  chapter: Relation<{ position: number; part: Relation<{ position: number }> }>;
};
type SectionContext = {
  id: string;
  book_id: string;
  chapter_id: string;
  title: string;
  goal: string | null;
  target_words: number;
  status: string;
  chapter: Relation<{ id: string; title: string; goal: string | null; position: number }>;
  book: Relation<{
    id: string;
    user_id: string;
    title: string;
    subtitle: string | null;
    idea: string;
    reader_profiles: Relation<Record<string, unknown>>;
    writing_styles: Relation<Record<string, unknown>>;
    story_bibles: Relation<{ data: unknown }>;
    knowledge_maps: Relation<{ data: unknown }>;
  }>;
};

type SectionResult =
  | { kind: "completed"; title: string; wordCount: number; model: string }
  | { kind: "already-completed" }
  | { kind: "daily-limit" }
  | { kind: "connection-expired" }
  | { kind: "temporary-error"; message: string };

function one<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function outlinePosition(row: OutlineRow) {
  const chapter = one(row.chapter);
  const part = chapter ? one(chapter.part) : null;
  return [part?.position ?? 0, chapter?.position ?? 0, row.position] as const;
}

export async function generateFreeBookWorkflow(input: WorkflowInput) {
  "use workflow";

  try {
    await markJob(input.jobId, "GENERATING", "백그라운드 무료 AI 집필을 시작했습니다.", 0);
    const sections = await getOutline(input.bookId);
    const total = sections.length;

    for (let index = 0; index < total; index++) {
      const section = sections[index];
      if (section.status === "COMPLETED") continue;

      let sectionFinished = false;
      while (!sectionFinished) {
        let state = await getBookControlState(input.bookId);
        while (state === "PAUSED") {
          await markJob(input.jobId, "PAUSED", "사용자가 생성을 일시정지했습니다.", progressFrom(index, total));
          await sleep("15s");
          state = await getBookControlState(input.bookId);
        }

        if (state === "CANCELLED") {
          await markJob(input.jobId, "CANCELLED", "사용자가 생성을 취소했습니다.", progressFrom(index, total));
          return { status: "cancelled" };
        }

        const result = await generateFreeSectionStep({ ...input, sectionId: section.id });
        if (result.kind === "completed" || result.kind === "already-completed") {
          const progress = progressFrom(index + 1, total);
          await markSectionProgress(input, section.id, index + 1, total, progress, result);
          sectionFinished = true;
          continue;
        }

        if (result.kind === "daily-limit") {
          await markJob(
            input.jobId,
            "WAITING_LIMIT",
            "OpenRouter 무료 일일 한도에 도달했습니다. 저장된 위치에서 24시간 뒤 자동으로 다시 시도합니다.",
            progressFrom(index, total)
          );
          await sleep("24h");
          await markJob(input.jobId, "GENERATING", "무료 한도 대기 후 자동으로 집필을 재개합니다.", progressFrom(index, total));
          continue;
        }

        if (result.kind === "connection-expired") {
          await markNeedsReconnect(input, progressFrom(index, total));
          return { status: "needs-reconnect" };
        }

        await markTemporaryFailure(input, result.message, progressFrom(index, total));
        return { status: "paused-error", error: result.message };
      }
    }

    const composed = await composePagesStep(input.bookId);
    await finalizeBook(input, composed.pageCount);
    return { status: "completed", pageCount: composed.pageCount };
  } catch (error) {
    await failWorkflow(input, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

async function getOutline(bookId: string) {
  "use step";
  const supabase = createServiceSupabase();
  const { data, error } = await supabase.from("sections")
    .select("id,position,status,chapter:chapters(position,part:parts(position))")
    .eq("book_id", bookId);
  if (error) throw new FatalError(error.message);
  return ((data ?? []) as unknown as OutlineRow[]).sort((a, b) => {
    const aa = outlinePosition(a); const bb = outlinePosition(b);
    return aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2];
  });
}

async function getBookControlState(bookId: string) {
  "use step";
  const supabase = createServiceSupabase();
  const { data, error } = await supabase.from("books").select("status").eq("id", bookId).single();
  if (error || !data) throw new FatalError(error?.message ?? "BOOK_NOT_FOUND");
  return data.status as string;
}

async function loadOpenRouterKey(userId: string) {
  const supabase = createServiceSupabase();
  const { data, error } = await supabase.rpc<string | null>("get_openrouter_credential", { p_user_id: userId });
  if (error) throw new Error(error.message);
  return typeof data === "string" ? data : null;
}

async function generateFreeSectionStep(input: WorkflowInput & { sectionId: string }): Promise<SectionResult> {
  "use step";
  const supabase = createServiceSupabase();

  const { data: rawSection, error: sectionError } = await supabase.from("sections")
    .select("id,book_id,chapter_id,title,goal,target_words,status,chapter:chapters(id,title,goal,position),book:books!inner(id,user_id,title,subtitle,idea,reader_profiles(*),writing_styles(*),story_bibles(data),knowledge_maps(data))")
    .eq("id", input.sectionId).single();
  if (sectionError || !rawSection) throw new FatalError(sectionError?.message ?? "SECTION_NOT_FOUND");

  const section = rawSection as unknown as SectionContext;
  if (section.status === "COMPLETED") return { kind: "already-completed" };
  const chapter = one(section.chapter);
  const book = one(section.book);
  if (!chapter || !book || book.user_id !== input.userId) throw new FatalError("BOOK_ACCESS_DENIED");

  const key = await loadOpenRouterKey(input.userId);
  if (!key) return { kind: "connection-expired" };

  const { data: previousRows } = await supabase.from("sections")
    .select("title,summary")
    .eq("book_id", input.bookId)
    .eq("status", "COMPLETED")
    .order("updated_at", { ascending: false })
    .limit(8);

  const previousSummaries = (previousRows ?? []).filter((row) => typeof row.summary === "string" && row.summary.trim().length > 0);

  await Promise.all([
    supabase.from("sections").update({ status: "GENERATING" }).eq("id", section.id),
    supabase.from("books").update({ status: "GENERATING", current_section_id: section.id }).eq("id", input.bookId)
  ]);

  try {
    const provider = new OpenRouterFreeProvider(key);
    const draft = await provider.generateStructured({
      model: "openrouter/free",
      schemaName: "free_section_draft",
      jsonSchema: sectionDraftJsonSchema as unknown as Record<string, unknown>,
      system: `${sectionWriterSystem()}\nFREE MODE: No live web research is available in this pass. Never fabricate citations, URLs, statistics, studies, or claims of having checked the web. Prefer durable explanations and clearly qualify uncertain facts.`,
      prompt: sectionWriterPrompt({
        bookSummary: `${book.title} — ${book.subtitle ?? ""}\n${book.idea}`,
        chapterTitle: chapter.title,
        chapterGoal: chapter.goal ?? "",
        sectionTitle: section.title,
        sectionGoal: section.goal ?? "",
        targetWords: Math.min(Math.max(section.target_words, 500), 2200),
        readerProfile: one(book.reader_profiles) ?? {},
        writingStyle: one(book.writing_styles) ?? {},
        relevantMemory: previousSummaries.map((row) => ({ type: "previous_section", title: row.title, content: row.summary })),
        previousSectionSummary: previousSummaries[0]?.summary ?? undefined,
        researchNotes: "None — free mode does not perform live research.",
        storyBible: one(book.story_bibles)?.data ?? null,
        knowledgeMap: one(book.knowledge_maps)?.data ?? null
      }),
      parse: (value) => SectionDraftSchema.parse(value)
    });

    const markdown = draft.value.markdown.trim();
    const wordCount = markdown.split(/\s+/u).filter(Boolean).length;
    const writes = await Promise.all([
      supabase.from("sections").update({
        title: draft.value.title,
        content_markdown: markdown,
        summary: draft.value.summary,
        word_count: wordCount,
        status: "COMPLETED",
        updated_at: new Date().toISOString()
      }).eq("id", section.id),
      supabase.from("token_usage").insert({
        user_id: input.userId,
        book_id: input.bookId,
        operation: "FREE_SECTION_WRITE_BACKGROUND",
        model: draft.usage.model,
        input_tokens: draft.usage.inputTokens,
        output_tokens: draft.usage.outputTokens,
        estimated_cost: 0,
        duration_ms: draft.usage.durationMs,
        retry_count: 0
      })
    ]);
    const writeError = writes.find((result) => result.error)?.error;
    if (writeError) throw new FatalError(writeError.message);

    return { kind: "completed", title: draft.value.title, wordCount, model: draft.usage.model };
  } catch (error) {
    await supabase.from("sections").update({ status: "PLANNED" }).eq("id", section.id);
    const message = error instanceof Error ? error.message : "FREE_AI_FAILED";
    if (message === "FREE_AI_DAILY_LIMIT") return { kind: "daily-limit" };
    if (message === "FREE_AI_CONNECTION_EXPIRED" || message === "FREE_AI_CONNECTION_REQUIRED") return { kind: "connection-expired" };
    if (error instanceof FatalError) throw error;
    return { kind: "temporary-error", message };
  }
}

async function markJob(jobId: string, status: string, message: string, progress: number) {
  "use step";
  const supabase = createServiceSupabase();
  await Promise.all([
    supabase.from("generation_jobs").update({ status, progress, updated_at: new Date().toISOString() }).eq("id", jobId),
    supabase.from("job_logs").insert({ generation_job_id: jobId, level: status === "WAITING_LIMIT" ? "warning" : "info", message })
  ]);
}

async function markSectionProgress(
  input: WorkflowInput,
  sectionId: string,
  ordinal: number,
  total: number,
  progress: number,
  result: Extract<SectionResult, { kind: "completed" | "already-completed" }>
) {
  "use step";
  const supabase = createServiceSupabase();
  const message = result.kind === "completed"
    ? `백그라운드 Section ${ordinal}/${total} 완료: ${result.title}`
    : `이미 완료된 Section ${ordinal}/${total}을 건너뜁니다.`;
  await Promise.all([
    supabase.from("books").update({ status: "GENERATING", progress, current_section_id: sectionId }).eq("id", input.bookId),
    supabase.from("generation_jobs").update({ status: "GENERATING", progress, updated_at: new Date().toISOString() }).eq("id", input.jobId),
    supabase.from("job_logs").insert({
      generation_job_id: input.jobId,
      level: "info",
      message,
      metadata: result.kind === "completed" ? { sectionId, wordCount: result.wordCount, model: result.model } : { sectionId }
    })
  ]);
}

async function markNeedsReconnect(input: WorkflowInput, progress: number) {
  "use step";
  const supabase = createServiceSupabase();
  await Promise.all([
    supabase.from("books").update({ status: "PAUSED" }).eq("id", input.bookId),
    supabase.from("generation_jobs").update({ status: "NEEDS_RECONNECT", progress, updated_at: new Date().toISOString() }).eq("id", input.jobId),
    supabase.from("job_logs").insert({ generation_job_id: input.jobId, level: "warning", message: "무료 AI 연결이 만료되었습니다. 다시 연결하면 저장된 위치에서 이어서 생성할 수 있습니다." })
  ]);
}

async function markTemporaryFailure(input: WorkflowInput, message: string, progress: number) {
  "use step";
  const supabase = createServiceSupabase();
  await Promise.all([
    supabase.from("books").update({ status: "PAUSED" }).eq("id", input.bookId),
    supabase.from("generation_jobs").update({ status: "PAUSED_ERROR", progress, updated_at: new Date().toISOString() }).eq("id", input.jobId),
    supabase.from("job_logs").insert({ generation_job_id: input.jobId, level: "warning", message: `무료 AI 제공자 오류로 일시정지: ${message}` })
  ]);
}

async function composePagesStep(bookId: string) {
  "use step";
  return composeBookPages(bookId);
}

async function finalizeBook(input: WorkflowInput, pageCount: number) {
  "use step";
  const supabase = createServiceSupabase();
  await Promise.all([
    supabase.from("books").update({ status: "COMPLETED", progress: 100, current_section_id: null }).eq("id", input.bookId),
    supabase.from("generation_jobs").update({ status: "COMPLETED", progress: 100, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", input.jobId),
    supabase.from("job_logs").insert({ generation_job_id: input.jobId, level: "info", message: `백그라운드 무료 AI 책 완성 · ${pageCount} pages composed` })
  ]);
}

async function failWorkflow(input: WorkflowInput, message: string) {
  "use step";
  const supabase = createServiceSupabase();
  await Promise.all([
    supabase.from("books").update({ status: "PAUSED" }).eq("id", input.bookId),
    supabase.from("generation_jobs").update({ status: "FAILED", updated_at: new Date().toISOString() }).eq("id", input.jobId),
    supabase.from("job_logs").insert({ generation_job_id: input.jobId, level: "error", message: `백그라운드 생성 실패: ${message}` })
  ]);
}

function progressFrom(completed: number, total: number) {
  return total > 0 ? Math.min(99, (completed / total) * 100) : 100;
}
