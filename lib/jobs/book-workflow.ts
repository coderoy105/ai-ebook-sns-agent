import { sleep } from "workflow";
import { createServiceSupabase } from "@/lib/supabase/server";
import { llm } from "@/lib/ai/openai";
import { sectionDraftJsonSchema, reviewJsonSchema } from "@/lib/ai/json-schemas";
import { SectionDraftSchema, ReviewSchema } from "@/lib/ai/schemas";
import { sectionWriterPrompt, sectionWriterSystem } from "@/lib/ai/prompts";
import { addMemory, highestRepetitionScore, retrieveBookMemory } from "@/lib/memory/retrieval";
import { estimateOpenAICost } from "@/lib/ai/provider";
import { composeBookPages } from "@/lib/design/compose";

type WorkflowInput = { bookId: string; userId: string; jobId: string };

export async function generateBookWorkflow(input: WorkflowInput) {
  "use workflow";

  await markJob(input.jobId, "GENERATING", "Generation workflow started");

  const sectionIds = await getSectionIds(input.bookId);
  for (let index = 0; index < sectionIds.length; index++) {
    let state = await getBookControlState(input.bookId);
    while (state === "PAUSED") {
      await sleep("15s");
      state = await getBookControlState(input.bookId);
    }
    if (state === "CANCELLED") {
      await markJob(input.jobId, "CANCELLED", "Cancelled by user");
      return { status: "cancelled" };
    }

    await generateSectionStep({ ...input, sectionId: sectionIds[index], ordinal: index + 1, total: sectionIds.length });
  }

  await markJob(input.jobId, "REVIEWING", "Running global quality review");
  await globalReviewStep(input);
  await composePagesStep(input);
  await finalizeBook(input);
  return { status: "completed" };
}

async function getSectionIds(bookId: string) {
  "use step";
  const supabase = createServiceSupabase();
  const { data, error } = await supabase.from("sections").select("id, chapters(position), position").eq("book_id", bookId);
  if (error) throw error;
  return (data ?? [])
    .sort((a: any, b: any) => ((a.chapters?.position ?? 0) - (b.chapters?.position ?? 0)) || a.position - b.position)
    .map((row: any) => row.id as string);
}

async function getBookControlState(bookId: string) {
  "use step";
  const supabase = createServiceSupabase();
  const { data, error } = await supabase.from("books").select("status").eq("id", bookId).single();
  if (error) throw error;
  return data.status as string;
}

async function markJob(jobId: string, status: string, message: string) {
  "use step";
  const supabase = createServiceSupabase();
  await supabase.from("generation_jobs").update({ status, updated_at: new Date().toISOString() }).eq("id", jobId);
  await supabase.from("job_logs").insert({ generation_job_id: jobId, level: "info", message });
}

async function generateSectionStep(input: WorkflowInput & { sectionId: string; ordinal: number; total: number }) {
  "use step";
  const supabase = createServiceSupabase();

  const { data: section, error: sectionError } = await supabase
    .from("sections")
    .select("*, chapter:chapters(*), book:books(*, book_settings(*), reader_profiles(*), writing_styles(*), story_bibles(data), knowledge_maps(data))")
    .eq("id", input.sectionId)
    .single();
  if (sectionError) throw sectionError;
  if (section.status === "COMPLETED" && section.content_markdown) return;

  await supabase.from("sections").update({ status: "GENERATING" }).eq("id", input.sectionId);
  const stepStart = Date.now();
  const { data: step } = await supabase.from("generation_steps").insert({
    generation_job_id: input.jobId, book_id: input.bookId, section_id: input.sectionId,
    step_type: "SECTION_GENERATE", status: "RUNNING", attempt: 1, started_at: new Date().toISOString()
  }).select("id").single();

  try {
    const book = section.book;
    const reader = Array.isArray(book.reader_profiles) ? book.reader_profiles[0] : book.reader_profiles;
    const style = Array.isArray(book.writing_styles) ? book.writing_styles[0] : book.writing_styles;
    const storyBible = Array.isArray(book.story_bibles) ? book.story_bibles[0]?.data : book.story_bibles?.data;
    const knowledgeMap = Array.isArray(book.knowledge_maps) ? book.knowledge_maps[0]?.data : book.knowledge_maps?.data;
    const memory = await retrieveBookMemory(input.bookId, `${section.chapter.title}: ${section.goal}`, 10);

    const { data: previousRows } = await supabase.from("sections")
      .select("summary").eq("chapter_id", section.chapter_id).lt("position", section.position).order("position", { ascending: false }).limit(1);
    const previousSummary = previousRows?.[0]?.summary ?? undefined;

    let researchNotes = "";
    if (section.research_needed) {
      const research = await runResearch(section.title, section.goal);
      researchNotes = research.value.notes;
      for (const source of research.value.sources) {
        await supabase.from("sources").upsert({
          book_id: input.bookId, url: source.url, title: source.title, source_type: source.sourceType,
          reliability: source.reliability, metadata: { sectionId: input.sectionId }
        }, { onConflict: "book_id,url" });
      }
      await recordUsage({ supabase, userId: input.userId, bookId: input.bookId, operation: "RESEARCH", usage: research.usage });
    }

    const model = process.env.OPENAI_WRITER_MODEL ?? "gpt-5";
    let draft = await llm.generateStructured({
      model,
      schemaName: "section_draft",
      jsonSchema: sectionDraftJsonSchema as unknown as Record<string, unknown>,
      system: sectionWriterSystem(),
      prompt: sectionWriterPrompt({
        bookSummary: `${book.title} — ${book.subtitle ?? ""}\n${book.idea}`,
        chapterTitle: section.chapter.title,
        chapterGoal: section.chapter.goal,
        sectionTitle: section.title,
        sectionGoal: section.goal,
        targetWords: section.target_words,
        readerProfile: reader,
        writingStyle: style,
        relevantMemory: memory.map(({ content, memory_type, similarity }) => ({ content, memory_type, similarity })),
        previousSectionSummary: previousSummary,
        researchNotes,
        storyBible,
        knowledgeMap
      }),
      parse: (value) => SectionDraftSchema.parse(value)
    });
    await recordUsage({ supabase, userId: input.userId, bookId: input.bookId, operation: "SECTION_WRITE", usage: draft.usage });

    const repetition = await highestRepetitionScore(input.bookId, draft.value.summary, input.sectionId);
    if (repetition > 0.89) {
      draft = await llm.generateStructured({
        model,
        schemaName: "section_draft_rewrite",
        jsonSchema: sectionDraftJsonSchema as unknown as Record<string, unknown>,
        system: `${sectionWriterSystem()}\nThe first draft was too semantically similar to prior material. Rewrite from a distinctly new angle while preserving required facts.`,
        prompt: sectionWriterPrompt({
          bookSummary: `${book.title} — ${book.idea}`,
          chapterTitle: section.chapter.title, chapterGoal: section.chapter.goal,
          sectionTitle: section.title, sectionGoal: section.goal, targetWords: section.target_words,
          readerProfile: reader, writingStyle: style, relevantMemory: memory, previousSectionSummary: previousSummary,
          researchNotes, storyBible, knowledgeMap
        }),
        parse: (value) => SectionDraftSchema.parse(value)
      });
      await recordUsage({ supabase, userId: input.userId, bookId: input.bookId, operation: "SECTION_REWRITE_REPETITION", usage: draft.usage });
    }

    const wordCount = draft.value.markdown.trim().split(/\s+/u).length;
    await supabase.from("sections").update({
      title: draft.value.title,
      content_markdown: draft.value.markdown,
      summary: draft.value.summary,
      word_count: wordCount,
      status: "COMPLETED",
      updated_at: new Date().toISOString()
    }).eq("id", input.sectionId);

    await addMemory({
      bookId: input.bookId, type: "SECTION_SUMMARY", content: draft.value.summary,
      sourceSectionId: input.sectionId, metadata: { sectionId: input.sectionId, chapterId: section.chapter_id, repetitionScore: repetition }
    });
    for (const fact of draft.value.keyFacts.slice(0, 10)) {
      await addMemory({ bookId: input.bookId, type: "IMPORTANT_FACT", content: fact, sourceSectionId: input.sectionId });
    }
    for (const term of draft.value.newTerminology.slice(0, 8)) {
      await addMemory({ bookId: input.bookId, type: "TERMINOLOGY", content: `${term.term}: ${term.definition}`, sourceSectionId: input.sectionId });
    }

    const progress = (input.ordinal / input.total) * 92;
    await supabase.from("books").update({ status: "GENERATING", progress, current_section_id: input.sectionId }).eq("id", input.bookId);
    await supabase.from("generation_steps").update({
      status: "COMPLETED", finished_at: new Date().toISOString(), duration_ms: Date.now() - stepStart,
      output: { wordCount, repetition }
    }).eq("id", step?.id);
    await supabase.from("job_logs").insert({
      generation_job_id: input.jobId, level: "info",
      message: `Section ${input.ordinal}/${input.total} completed: ${draft.value.title}`,
      metadata: { sectionId: input.sectionId, wordCount, repetition }
    });
  } catch (error) {
    await supabase.from("sections").update({ status: "FAILED" }).eq("id", input.sectionId);
    await supabase.from("generation_steps").update({
      status: "FAILED", finished_at: new Date().toISOString(), duration_ms: Date.now() - stepStart,
      error_message: error instanceof Error ? error.message : String(error)
    }).eq("id", step?.id);
    throw error;
  }
}

async function runResearch(title: string, goal: string) {
  const researchSchema = {
    type: "object", additionalProperties: false, required: ["notes","sources"],
    properties: {
      notes: { type: "string" },
      sources: {
        type: "array", items: {
          type: "object", additionalProperties: false, required: ["title","url","sourceType","reliability"],
          properties: {
            title: { type: "string" }, url: { type: "string" }, sourceType: { type: "string" },
            reliability: { type: "number", minimum: 0, maximum: 1 }
          }
        }
      }
    }
  };
  return llm.generateStructured({
    model: process.env.OPENAI_RESEARCH_MODEL ?? "gpt-5",
    schemaName: "research_notes", jsonSchema: researchSchema,
    system: "Research for a book section using current web sources. Prefer government, international organizations, universities, papers, official documentation and reputable news. Do not fabricate URLs.",
    prompt: `Section: ${title}\nGoal: ${goal}\nReturn compact evidence notes and only sources you actually used.`,
    webSearch: true,
    parse: (value: any) => ({
      notes: String(value.notes ?? ""),
      sources: Array.isArray(value.sources) ? value.sources.map((source: any) => ({
        title: String(source.title ?? ""),
        url: String(source.url ?? ""),
        sourceType: String(source.sourceType ?? "web"),
        reliability: Number(source.reliability ?? 0.5)
      })).filter((source: any) => /^https?:\/\//.test(source.url)) : []
    })
  });
}

async function globalReviewStep(input: WorkflowInput) {
  "use step";
  const supabase = createServiceSupabase();
  const { data: book } = await supabase.from("books").select("*, chapters(id,title,goal,summary,sections(title,summary,word_count))").eq("id", input.bookId).single();
  if (!book) throw new Error("Book not found for review.");

  const response = await llm.generateStructured({
    model: process.env.OPENAI_REVIEWER_MODEL ?? "gpt-5",
    schemaName: "book_review",
    jsonSchema: reviewJsonSchema as unknown as Record<string, unknown>,
    system: "You are a rigorous book-level editor. Judge the whole plan and chapter/section summaries. Flag only concrete issues that warrant targeted revision.",
    prompt: JSON.stringify(book).slice(0, 180000),
    parse: (value) => ReviewSchema.parse(value)
  });
  await recordUsage({ supabase, userId: input.userId, bookId: input.bookId, operation: "GLOBAL_REVIEW", usage: response.usage });
  await supabase.from("books").update({ quality_scores: response.value.scores, quality_score: response.value.overallScore }).eq("id", input.bookId);
  await supabase.from("book_reviews").insert({ book_id: input.bookId, generation_job_id: input.jobId, review: response.value });
}

async function composePagesStep(input: WorkflowInput) {
  "use step";
  const supabase = createServiceSupabase();
  const result = await composeBookPages(input.bookId);
  await supabase.from("job_logs").insert({
    generation_job_id: input.jobId, level: "info",
    message: `Page composition completed: ${result.pageCount} pages using ${result.templateId}`
  });
}

async function finalizeBook(input: WorkflowInput) {
  "use step";
  const supabase = createServiceSupabase();
  await supabase.from("books").update({ status: "COMPLETED", progress: 100, completed_at: new Date().toISOString() }).eq("id", input.bookId);
  await supabase.from("generation_jobs").update({ status: "COMPLETED", progress: 100, finished_at: new Date().toISOString() }).eq("id", input.jobId);
  await supabase.from("job_logs").insert({ generation_job_id: input.jobId, level: "info", message: "Book generation completed" });
}

async function recordUsage({ supabase, userId, bookId, operation, usage }: any) {
  await supabase.from("token_usage").insert({
    user_id: userId, book_id: bookId, operation, model: usage.model,
    input_tokens: usage.inputTokens, output_tokens: usage.outputTokens,
    estimated_cost: estimateOpenAICost(usage.model, usage.inputTokens, usage.outputTokens),
    duration_ms: usage.durationMs, retry_count: 0, provider_request_id: usage.requestId ?? null
  });
}
