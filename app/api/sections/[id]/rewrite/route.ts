import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { llm } from "@/lib/ai/openai";
import { openRouterProviderFromRequest } from "@/lib/ai/openrouter-free";
import { assertRateLimit } from "@/lib/security/rate-limit";

const Schema = z.object({ instruction: z.string().min(3).max(3000) });
const RewriteSchema = {
  type: "object", additionalProperties: false, required: ["markdown","summary"],
  properties: { markdown: { type: "string" }, summary: { type: "string" } }
};

type RewritePayload = { markdown?: unknown; summary?: unknown };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireUser();
    await assertRateLimit(user.id, "ai-edit", 30, 3600);
    const { instruction } = Schema.parse(await request.json());
    const { data: section, error } = await supabase.from("sections")
      .select("*, chapter:chapters(title,goal), book:books!inner(user_id,title,idea)")
      .eq("id", id).single();
    if (error || !section || section.book.user_id !== user.id) return NextResponse.json({ error: "Not found." }, { status: 404 });

    await supabase.from("revisions").insert({
      book_id: section.book_id, section_id: id, user_id: user.id, revision_type: "AI",
      title_before: section.title, content_before: section.content_markdown, instruction
    });

    const freeProvider = openRouterProviderFromRequest(request);
    const provider = freeProvider ?? llm;
    const result = await provider.generateStructured({
      model: freeProvider ? "openrouter/free" : (process.env.OPENAI_EDITOR_MODEL ?? "gpt-5"),
      schemaName: "section_rewrite",
      jsonSchema: RewriteSchema,
      system: `You are the AI editor inside a professional book editor. Apply the user's instruction only to this section. Preserve established facts and do not imitate named authors.${freeProvider ? " Free mode has no live web research; never fabricate citations or claims of checking the web." : ""}`,
      prompt: `BOOK: ${section.book.title}\nCHAPTER: ${section.chapter.title}\nSECTION: ${section.title}\nINSTRUCTION: ${instruction}\n\nCURRENT MARKDOWN:\n${section.content_markdown ?? ""}`,
      parse: (value: unknown) => {
        const parsed = value as RewritePayload;
        return { markdown: String(parsed.markdown ?? ""), summary: String(parsed.summary ?? "") };
      }
    });

    await Promise.all([
      supabase.from("sections").update({
        content_markdown: result.value.markdown, summary: result.value.summary,
        word_count: result.value.markdown.trim().split(/\s+/u).filter(Boolean).length,
        updated_at: new Date().toISOString()
      }).eq("id", id),
      supabase.from("token_usage").insert({
        user_id: user.id,
        book_id: section.book_id,
        operation: freeProvider ? "FREE_SECTION_REWRITE" : "SECTION_REWRITE",
        model: result.usage.model,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        estimated_cost: freeProvider ? 0 : 0,
        duration_ms: result.usage.durationMs,
        retry_count: 0
      })
    ]);

    return NextResponse.json({ ...result.value, aiMode: freeProvider ? "free" : "paid" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rewrite failed.";
    return NextResponse.json({ error: message }, { status: message === "FREE_AI_DAILY_LIMIT" ? 429 : 400 });
  }
}
