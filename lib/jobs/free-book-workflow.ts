import { FatalError, sleep } from "workflow";
import { createServiceSupabase } from "@/lib/supabase/server";
import {
  backgroundProviderLabel,
  generateBackgroundStructured,
  type BackgroundAiProvider
} from "@/lib/ai/background-provider";
import { sectionDraftJsonSchema } from "@/lib/ai/json-schemas";
import { SectionDraftSchema } from "@/lib/ai/schemas";
import { sectionWriterPrompt, sectionWriterSystem } from "@/lib/ai/prompts";
import { composeBookPages } from "@/lib/design/compose";

type WorkflowInput = { bookId: string; userId: string; jobId: string; provider: BackgroundAiProvider };
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
  | { kind: "usage-limit" }
  | { kind: "connection-expired" }
  | { kind: "temporary-error"; message: string };

type BookStepRequest =
  | { action: "mark"; input: WorkflowInput; status: string; message: string; progress: number }
  | { action: "outline"; input: WorkflowInput }
  | { action: "control"; input: WorkflowInput }
  | { action: "section"; input: WorkflowInput; sectionId: string }
  | { action: "progress"; input: WorkflowInput; sectionId: string; ordinal: number; total: number; progress: number; result: Extract<SectionResult, { kind: "completed" | "already-completed" }> }
  | { action: "reconnect"; input: WorkflowInput; progress: number }
  | { action: "temporary-failure"; input: WorkflowInput; message: string; progress: number }
  | { action: "compose"; input: WorkflowInput }
  | { action: "finalize"; input: WorkflowInput; pageCount: number }
  | { action: "fail"; input: WorkflowInput; message: string };

type BookStepResult =
  | { kind: "ok" }
  | { kind: "outline"; sections: OutlineRow[] }
  | { kind: "control"; state: string }
  | { kind: "composed"; pageCount: number }
  | SectionResult;

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

  const providerLabel = backgroundProviderLabel(input.provider);
  try {
    await bookStep({ action: "mark", input, status: "GENERATING", message: `${providerLabel} 백그라운드 집필을 시작했습니다.`, progress: 0 });
    const outline = await bookStep({ action: "outline", input }) as { kind: "outline"; sections: OutlineRow[] };
    const sections = outline.sections;
    const total = sections.length;

    for (let index = 0; index < total; index++) {
      const section = sections[index];
      if (section.status === "COMPLETED") continue;

      let sectionFinished = false;
      while (!sectionFinished) {
        let control = await bookStep({ action: "control", input }) as { kind: "control"; state: string };
        let state = control.state;
        while (state === "PAUSED") {
          await bookStep({ action: "mark", input, status: "PAUSED", message: "사용자가 생성을 일시정지했습니다.", progress: progressFrom(index, total) });
          await sleep("15s");
          control = await bookStep({ action: "control", input }) as { kind: "control"; state: string };
          state = control.state;
        }

        if (state === "CANCELLED") {
          await bookStep({ action: "mark", input, status: "CANCELLED", message: "사용자가 생성을 취소했습니다.", progress: progressFrom(index, total) });
          return { status: "cancelled" };
        }

        const result = await bookStep({ action: "section", input, sectionId: section.id }) as SectionResult;
        if (result.kind === "completed" || result.kind === "already-completed") {
          const progress = progressFrom(index + 1, total);
          await bookStep({ action: "progress", input, sectionId: section.id, ordinal: index + 1, total, progress, result });
          sectionFinished = true;
          continue;
        }

        if (result.kind === "usage-limit") {
          await bookStep({
            action: "mark",
            input,
            status: "WAITING_LIMIT",
            message: input.provider === "codex"
              ? "ChatGPT/Codex 사용 한도에 도달했습니다. 현재 Section 이전까지 저장되어 있으며 1시간 뒤 자동 확인합니다."
              : "OpenRouter 무료 일일 한도에 도달했습니다. 현재 Section 이전까지 저장되어 있으며 24시간 뒤 자동 재개합니다.",
            progress: progressFrom(index, total)
          });
          await sleep(input.provider === "codex" ? "1h" : "24h");
          await bookStep({ action: "mark", input, status: "GENERATING", message: `${providerLabel} 사용 한도 대기 후 자동으로 집필을 재개합니다.`, progress: progressFrom(index, total) });
          continue;
        }

        if (result.kind === "connection-expired") {
          await bookStep({ action: "reconnect", input, progress: progressFrom(index, total) });
          return { status: "needs-reconnect" };
        }

        await bookStep({ action: "temporary-failure", input, message: result.message, progress: progressFrom(index, total) });
        return { status: "paused-error", error: result.message };
      }
    }

    const composed = await bookStep({ action: "compose", input }) as { kind: "composed"; pageCount: number };
    await bookStep({ action: "finalize", input, pageCount: composed.pageCount });
    return { status: "completed", pageCount: composed.pageCount };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await bookStep({ action: "fail", input, message });
    throw error;
  }
}

async function bookStep(request: BookStepRequest): Promise<BookStepResult> {
  "use step";

  switch (request.action) {
    case "mark":
      await markJob(request.input.jobId, request.status, request.message, request.progress);
      return { kind: "ok" };
    case "outline":
      return { kind: "outline", sections: await getOutline(request.input.bookId) };
    case "control":
      return { kind: "control", state: await getBookControlState(request.input.bookId) };
    case "section":
      return generateSection(request.input, request.sectionId);
    case "progress":
      await markSectionProgress(request.input, request.sectionId, request.ordinal, request.total, request.progress, request.result);
      return { kind: "ok" };
    case "reconnect":
      await markNeedsReconnect(request.input, request.progress);
      return { kind: "ok" };
    case "temporary-failure":
      await markTemporaryFailure(request.input, request.message, request.progress);
      return { kind: "ok" };
    case "compose": {
      const composed = await composeBookPages(request.input.bookId);
      return { kind: "composed", pageCount: composed.pageCount };
    }
    case "finalize":
      await finalizeBook(request.input, request.pageCount);
      return { kind: "ok" };
    case "fail":
      await failWorkflow(request.input, request.message);
      return { kind: "ok" };
  }
}

async function getOutline(bookId: string) {
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
  const supabase = createServiceSupabase();
  const { data, error } = await supabase.from("books").select("status").eq("id", bookId).single();
  if (error || !data) throw new FatalError(error?.message ?? "BOOK_NOT_FOUND");
  return data.status as string;
}

async function generateSection(input: WorkflowInput, sectionId: string): Promise<SectionResult> {
  const supabase = createServiceSupabase();

  const { data: rawSection, error: sectionError } = await supabase.from("sections")
    .select("id,book_id,chapter_id,title,goal,target_words,status,chapter:chapters(id,title,goal,position),book:books!sections_book_id_fkey(id,user_id,title,subtitle,idea,reader_profiles(*),writing_styles(*),story_bibles(data),knowledge_maps(data))")
    .eq("id", sectionId).single();
  if (sectionError || !rawSection) throw new FatalError(sectionError?.message ?? "SECTION_NOT_FOUND");

  const section = rawSection as unknown as SectionContext;
  if (section.status === "COMPLETED") return { kind: "already-completed" };
  const chapter = one(section.chapter);
  const book = one(section.book);
  if (!chapter || !book || book.user_id !== input.userId) throw new FatalError("BOOK_ACCESS_DENIED");

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
    const draft = await generateBackgroundStructured(input.provider, input.userId, {
      schemaName: "background_section_draft",
      jsonSchema: sectionDraftJsonSchema as unknown as Record<string, unknown>,
      system: `${sectionWriterSystem()}\nBACKGROUND MODE: Live web research is disabled for this pass. Never fabricate citations, URLs, statistics, studies, or claims of having checked the web. Prefer durable explanations and clearly qualify uncertain facts.`,
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
        researchNotes: "None — this background pass does not perform live research.",
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
        operation: input.provider === "codex" ? "CODEX_LUNA_SECTION_WRITE_BACKGROUND" : "FREE_SECTION_WRITE_BACKGROUND",
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
    const message = error instanceof Error ? error.message : "BACKGROUND_AI_FAILED";
    if (message === "FREE_AI_DAILY_LIMIT" || message === "CODEX_USAGE_LIMIT") return { kind: "usage-limit" };
    if (
      message === "FREE_AI_CONNECTION_EXPIRED" ||
      message === "FREE_AI_CONNECTION_REQUIRED" ||
      message === "CODEX_CONNECTION_EXPIRED" ||
      message === "CODEX_CONNECTION_REQUIRED"
    ) return { kind: "connection-expired" };
    if (error instanceof FatalError) throw error;
    return { kind: "temporary-error", message };
  }
}

async function markJob(jobId: string, status: string, message: string, progress: number) {
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
  const supabase = createServiceSupabase();
  const message = result.kind === "completed"
    ? `백그라운드 Section ${ordinal}/${total} 완료: ${result.title} · ${backgroundProviderLabel(input.provider)}`
    : `이미 완료된 Section ${ordinal}/${total}을 건너뜁니다.`;
  await Promise.all([
    supabase.from("books").update({ status: "GENERATING", progress, current_section_id: sectionId }).eq("id", input.bookId),
    supabase.from("generation_jobs").update({ status: "GENERATING", progress, updated_at: new Date().toISOString() }).eq("id", input.jobId),
    supabase.from("job_logs").insert({
      generation_job_id: input.jobId,
      level: "info",
      message,
      metadata: result.kind === "completed" ? { sectionId, wordCount: result.wordCount, model: result.model, provider: input.provider } : { sectionId }
    })
  ]);
}

async function markNeedsReconnect(input: WorkflowInput, progress: number) {
  const supabase = createServiceSupabase();
  await Promise.all([
    supabase.from("books").update({ status: "PAUSED" }).eq("id", input.bookId),
    supabase.from("generation_jobs").update({ status: "NEEDS_RECONNECT", progress, updated_at: new Date().toISOString() }).eq("id", input.jobId),
    supabase.from("job_logs").insert({ generation_job_id: input.jobId, level: "warning", message: `${backgroundProviderLabel(input.provider)} 연결이 만료되었습니다. 다시 연결하면 저장된 위치에서 이어서 생성할 수 있습니다.` })
  ]);
}

async function markTemporaryFailure(input: WorkflowInput, message: string, progress: number) {
  const supabase = createServiceSupabase();
  await Promise.all([
    supabase.from("books").update({ status: "PAUSED" }).eq("id", input.bookId),
    supabase.from("generation_jobs").update({ status: "PAUSED_ERROR", progress, updated_at: new Date().toISOString() }).eq("id", input.jobId),
    supabase.from("job_logs").insert({ generation_job_id: input.jobId, level: "warning", message: `${backgroundProviderLabel(input.provider)} 제공자 오류로 일시정지: ${message}` })
  ]);
}

async function finalizeBook(input: WorkflowInput, pageCount: number) {
  const supabase = createServiceSupabase();
  await Promise.all([
    supabase.from("books").update({ status: "COMPLETED", progress: 100, current_section_id: null }).eq("id", input.bookId),
    supabase.from("generation_jobs").update({ status: "COMPLETED", progress: 100, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", input.jobId),
    supabase.from("job_logs").insert({ generation_job_id: input.jobId, level: "info", message: `${backgroundProviderLabel(input.provider)} 백그라운드 책 완성 · ${pageCount} pages composed` })
  ]);
}

async function failWorkflow(input: WorkflowInput, message: string) {
  const supabase = createServiceSupabase();
  await Promise.all([
    supabase.from("books").update({ status: "PAUSED" }).eq("id", input.bookId),
    supabase.from("generation_jobs").update({ status: "FAILED", updated_at: new Date().toISOString() }).eq("id", input.jobId),
    supabase.from("job_logs").insert({ generation_job_id: input.jobId, level: "error", message: `${backgroundProviderLabel(input.provider)} 백그라운드 생성 실패: ${message}` })
  ]);
}

function progressFrom(completed: number, total: number) {
  return total > 0 ? Math.min(99, (completed / total) * 100) : 100;
}
