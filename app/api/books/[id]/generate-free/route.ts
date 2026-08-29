import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { openRouterProviderFromRequest } from "@/lib/ai/openrouter-free";
import { sectionDraftJsonSchema } from "@/lib/ai/json-schemas";
import { SectionDraftSchema } from "@/lib/ai/schemas";
import { sectionWriterPrompt, sectionWriterSystem } from "@/lib/ai/prompts";
import { composeBookPages } from "@/lib/design/compose";
import { assertRateLimit } from "@/lib/security/rate-limit";

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

function one<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function outlinePosition(row: OutlineRow) {
  const chapter = one(row.chapter);
  const part = chapter ? one(chapter.part) : null;
  return [part?.position ?? 0, chapter?.position ?? 0, row.position] as const;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: bookId } = await params;
  try {
    const { supabase, user } = await requireUser();
    const provider = openRouterProviderFromRequest(request);
    if (!provider) return NextResponse.json({ error: "FREE_AI_CONNECTION_REQUIRED" }, { status: 428 });
    await assertRateLimit(user.id, "free-ai-section", 120, 3600);

    const { data: bookState, error: bookStateError } = await supabase.from("books")
      .select("id,user_id,status,progress")
      .eq("id", bookId).single();
    if (bookStateError || !bookState || bookState.user_id !== user.id) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (bookState.status === "PAUSED") return NextResponse.json({ paused: true, progress: Number(bookState.progress) }, { status: 409 });
    if (bookState.status === "CANCELLED") return NextResponse.json({ cancelled: true, progress: Number(bookState.progress) }, { status: 409 });

    const { data: rawOutline, error: outlineError } = await supabase.from("sections")
      .select("id,position,status,chapter:chapters(position,part:parts(position))")
      .eq("book_id", bookId);
    if (outlineError) throw outlineError;
    const outline = ((rawOutline ?? []) as unknown as OutlineRow[]).sort((a, b) => {
      const aa = outlinePosition(a); const bb = outlinePosition(b);
      return aa[0] - bb[0] || aa[1] - bb[1] || aa[2] - bb[2];
    });
    const total = outline.length;
    const completedBefore = outline.filter((row) => row.status === "COMPLETED").length;
    const next = outline.find((row) => row.status !== "COMPLETED");

    const { data: existingJobs } = await supabase.from("generation_jobs")
      .select("id")
      .eq("book_id", bookId)
      .eq("workflow_run_id", "openrouter-free")
      .order("created_at", { ascending: false })
      .limit(1);
    let jobId = existingJobs?.[0]?.id as string | undefined;
    if (!jobId) {
      const { data: job, error: jobError } = await supabase.from("generation_jobs").insert({
        book_id: bookId,
        user_id: user.id,
        status: "GENERATING",
        progress: total ? (completedBefore / total) * 100 : 0,
        workflow_run_id: "openrouter-free",
        started_at: new Date().toISOString()
      }).select("id").single();
      if (jobError) throw jobError;
      jobId = job.id;
    } else {
      await supabase.from("generation_jobs").update({ status: "GENERATING" }).eq("id", jobId);
    }

    if (!next) {
      const composed = await composeBookPages(bookId);
      await Promise.all([
        supabase.from("books").update({ status: "COMPLETED", progress: 100, current_section_id: null }).eq("id", bookId),
        supabase.from("generation_jobs").update({ status: "COMPLETED", progress: 100, finished_at: new Date().toISOString() }).eq("id", jobId),
        supabase.from("job_logs").insert({ generation_job_id: jobId, level: "info", message: `무료 AI 집필 완료 · ${composed.pageCount} pages composed` })
      ]);
      return NextResponse.json({ done: true, progress: 100, pageCount: composed.pageCount });
    }

    const { data: rawSection, error: sectionError } = await supabase.from("sections")
      .select("id,book_id,chapter_id,title,goal,target_words,chapter:chapters(id,title,goal,position),book:books!inner(id,user_id,title,subtitle,idea,reader_profiles(*),writing_styles(*),story_bibles(data),knowledge_maps(data))")
      .eq("id", next.id).single();
    if (sectionError || !rawSection) throw sectionError ?? new Error("Section not found.");
    const section = rawSection as unknown as SectionContext;
    const chapter = one(section.chapter);
    const book = one(section.book);
    if (!chapter || !book || book.user_id !== user.id) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const { data: previousRows } = await supabase.from("sections")
      .select("title,summary")
      .eq("book_id", bookId)
      .eq("status", "COMPLETED")
      .not("summary", "is", null)
      .order("updated_at", { ascending: false })
      .limit(8);

    await Promise.all([
      supabase.from("sections").update({ status: "GENERATING" }).eq("id", section.id),
      supabase.from("books").update({ status: "GENERATING", current_section_id: section.id }).eq("id", bookId)
    ]);

    try {
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
          relevantMemory: (previousRows ?? []).map((row) => ({ type: "previous_section", title: row.title, content: row.summary })),
          previousSectionSummary: previousRows?.[0]?.summary ?? undefined,
          researchNotes: "None — free mode does not perform live research.",
          storyBible: one(book.story_bibles)?.data ?? null,
          knowledgeMap: one(book.knowledge_maps)?.data ?? null
        }),
        parse: (value) => SectionDraftSchema.parse(value)
      });

      const markdown = draft.value.markdown.trim();
      const wordCount = markdown.split(/\s+/u).filter(Boolean).length;
      const completed = completedBefore + 1;
      const progress = total ? Math.min(99, (completed / total) * 100) : 100;
      const done = completed >= total;

      await Promise.all([
        supabase.from("sections").update({
          title: draft.value.title,
          content_markdown: markdown,
          summary: draft.value.summary,
          word_count: wordCount,
          status: "COMPLETED",
          updated_at: new Date().toISOString()
        }).eq("id", section.id),
        supabase.from("books").update({ status: done ? "GENERATING" : "GENERATING", progress, current_section_id: section.id }).eq("id", bookId),
        supabase.from("generation_jobs").update({ status: "GENERATING", progress }).eq("id", jobId),
        supabase.from("token_usage").insert({
          user_id: user.id,
          book_id: bookId,
          operation: "FREE_SECTION_WRITE",
          model: draft.usage.model,
          input_tokens: draft.usage.inputTokens,
          output_tokens: draft.usage.outputTokens,
          estimated_cost: 0,
          duration_ms: draft.usage.durationMs,
          retry_count: 0
        }),
        supabase.from("job_logs").insert({
          generation_job_id: jobId,
          level: "info",
          message: `무료 AI Section ${completed}/${total} 완료: ${draft.value.title}`,
          metadata: { sectionId: section.id, wordCount, model: draft.usage.model }
        })
      ]);

      if (done) {
        const composed = await composeBookPages(bookId);
        await Promise.all([
          supabase.from("books").update({ status: "COMPLETED", progress: 100, current_section_id: null }).eq("id", bookId),
          supabase.from("generation_jobs").update({ status: "COMPLETED", progress: 100, finished_at: new Date().toISOString() }).eq("id", jobId),
          supabase.from("job_logs").insert({ generation_job_id: jobId, level: "info", message: `무료 AI 책 완성 · ${composed.pageCount} pages composed` })
        ]);
        return NextResponse.json({ done: true, progress: 100, sectionId: section.id, title: draft.value.title, wordCount, pageCount: composed.pageCount });
      }

      return NextResponse.json({ done: false, progress, sectionId: section.id, title: draft.value.title, wordCount, remaining: total - completed });
    } catch (error) {
      const message = error instanceof Error ? error.message : "FREE_AI_FAILED";
      if (message === "FREE_AI_DAILY_LIMIT") {
        await Promise.all([
          supabase.from("sections").update({ status: "PLANNED" }).eq("id", section.id),
          supabase.from("books").update({ status: "PAUSED" }).eq("id", bookId),
          supabase.from("generation_jobs").update({ status: "PAUSED" }).eq("id", jobId),
          supabase.from("job_logs").insert({ generation_job_id: jobId, level: "warning", message: "OpenRouter 무료 일일 한도에 도달했습니다. 다음 무료 한도에서 이어서 생성할 수 있습니다." })
        ]);
        return NextResponse.json({ error: message, paused: true, progress: total ? (completedBefore / total) * 100 : 0 }, { status: 429 });
      }
      await supabase.from("sections").update({ status: "PLANNED" }).eq("id", section.id);
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Free generation failed.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "RATE_LIMITED" ? 429 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
