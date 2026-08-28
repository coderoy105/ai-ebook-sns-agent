import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";

const UpdateSchema = z.object({ content: z.string().max(250000), title: z.string().max(500).optional() });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireUser();
    const input = UpdateSchema.parse(await request.json());
    const { data: existing, error } = await supabase.from("sections").select("id,title,content_markdown,book_id,books!inner(user_id)").eq("id", id).single();
    if (error || !existing || (existing.books as any).user_id !== user.id) return NextResponse.json({ error: "Not found." }, { status: 404 });

    await supabase.from("revisions").insert({
      book_id: existing.book_id, section_id: id, user_id: user.id, revision_type: "MANUAL",
      title_before: existing.title, content_before: existing.content_markdown
    });
    const { error: updateError } = await supabase.from("sections").update({
      content_markdown: input.content,
      ...(input.title ? { title: input.title } : {}),
      word_count: input.content.trim().split(/\s+/u).filter(Boolean).length,
      updated_at: new Date().toISOString()
    }).eq("id", id);
    if (updateError) throw updateError;
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Save failed." }, { status: 400 });
  }
}
