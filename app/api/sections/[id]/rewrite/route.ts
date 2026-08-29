import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase, requireUser } from "@/lib/supabase/server";
import { generateBackgroundStructured, hasBackgroundCredential, normalizeBackgroundProvider } from "@/lib/ai/background-provider";
import { assertRateLimit } from "@/lib/security/rate-limit";

const Schema = z.object({ instruction: z.string().min(3).max(3000) });
const RewriteSchema = {
  type: "object", additionalProperties: false, required: ["markdown","summary"],
  properties: { markdown: { type: "string" }, summary: { type: "string" } }
};

type RewritePayload = { markdown?: unknown; summary?: unknown };
type Relation<T> = T | T[] | null;
type SettingsRow = { planning_input?: { aiProvider?: unknown } | null };

function one<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireUser();
    await assertRateLimit(user.id, "ai-edit", 30, 3600);
    const { instruction } = Schema.parse(await request.json());
    const { data: section, error } = await supabase.from("sections")
      .select("*, chapter:chapters(title,goal), book:books!sections_book_id_fkey(user_id,title,idea,book_settings(planning_input))")
      .eq("id", id).single();
    if (error || !section || section.book.user_id !== user.id) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const settings = one(section.book.book_settings as unknown as Relation<SettingsRow>);
    const provider = normalizeBackgroundProvider(settings?.planning_input?.aiProvider);
    const service = createServiceSupabase();

    if (provider === "openrouter") {
      const requestKey = request.headers.get("x-openrouter-key")?.trim();
      if (requestKey && requestKey.length >= 16) {
        const { error: saveError } = await service.rpc("store_openrouter_credential", { p_user_id: user.id, p_secret: requestKey });
        if (saveError) throw new Error(saveError.message);
      }
    }

    if (!(await hasBackgroundCredential(user.id, provider))) {
      return NextResponse.json({
        error: provider === "codex" ? "CODEX_CONNECTION_REQUIRED" : "FREE_AI_CONNECTION_REQUIRED",
        reconnect: true,
        provider
      }, { status: 428 });
    }

    await supabase.from("revisions").insert({
      book_id: section.book_id, section_id: id, user_id: user.id, revision_type: "AI",
      title_before: section.title, content_before: section.content_markdown, instruction
    });

    const result = await generateBackgroundStructured(provider, user.id, {
      schemaName: "section_rewrite",
      jsonSchema: RewriteSchema,
      system: "You are the AI editor inside a professional book editor. Apply the user's instruction only to this section. Preserve established facts and do not imitate named authors. Live web research is disabled; never fabricate citations or claims of checking the web.",
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
        operation: provider === "codex" ? "CODEX_LUNA_SECTION_REWRITE" : "FREE_SECTION_REWRITE",
        model: result.usage.model,
        input_tokens: result.usage.inputTokens,
        output_tokens: result.usage.outputTokens,
        estimated_cost: 0,
        duration_ms: result.usage.durationMs,
        retry_count: 0
      })
    ]);

    return NextResponse.json({ ...result.value, aiMode: provider, model: result.usage.model });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rewrite failed.";
    const status = message === "FREE_AI_DAILY_LIMIT" || message === "CODEX_USAGE_LIMIT" ? 429 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
