import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";
import { llm } from "@/lib/ai/openai";
import { assertRateLimit } from "@/lib/security/rate-limit";

const Schema = z.object({ instruction: z.string().min(3).max(3000) });
const RewriteSchema = {
  type: "object", additionalProperties: false, required: ["markdown","summary"],
  properties: { markdown: { type: "string" }, summary: { type: "string" } }
};

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

    const result = await llm.generateStructured({
      model: process.env.OPENAI_EDITOR_MODEL ?? "gpt-5",
      schemaName: "section_rewrite",
      jsonSchema: RewriteSchema,
      system: "You are the AI editor inside a professional book editor. Apply the user's instruction only to this section. Preserve established facts and do not imitate named authors.",
      prompt: `BOOK: ${section.book.title}\nCHAPTER: ${section.chapter.title}\nSECTION: ${section.title}\nINSTRUCTION: ${instruction}\n\nCURRENT MARKDOWN:\n${section.content_markdown ?? ""}`,
      parse: (value: any) => ({ markdown: String(value.markdown ?? ""), summary: String(value.summary ?? "") })
    });

    await supabase.from("sections").update({
      content_markdown: result.value.markdown, summary: result.value.summary,
      word_count: result.value.markdown.trim().split(/\s+/u).filter(Boolean).length,
      updated_at: new Date().toISOString()
    }).eq("id", id);

    return NextResponse.json(result.value);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Rewrite failed." }, { status: 400 });
  }
}
