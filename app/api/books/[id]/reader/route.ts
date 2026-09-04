import { NextResponse } from "next/server";
import { composeBookPages } from "@/lib/design/compose";
import { createServiceSupabase, requireUser } from "@/lib/supabase/server";
import { resolveRuntimeDesign, runtimeDesignSnapshot, type TemplateDbRow } from "@/lib/design/runtime-template";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { supabase, user } = await requireUser();
    const { data: book, error: bookError } = await supabase.from("books")
      .select("id,title,subtitle,book_type,status,target_pages,user_id,updated_at")
      .eq("id", id)
      .eq("user_id", user.id)
      .single();

    if (bookError || !book) return jsonError("BOOK_NOT_FOUND", 404);

    if (book.status === "COMPLETED") {
      await composeBookPages(id);
    }

    const service = createServiceSupabase();
    const { data: pages, error: pagesError } = await service.from("pages")
      .select("id,page_number,layout_type,template_id,content")
      .eq("book_id", id)
      .order("page_number", { ascending: true });

    if (pagesError) throw pagesError;
    if (!pages?.length) {
      return jsonError(book.status === "COMPLETED" ? "BOOK_PAGES_NOT_READY" : "BOOK_NOT_COMPLETED", 409);
    }

    const templateId = pages[0]?.template_id ?? "modern-editorial";
    const embeddedDesign = pages[0]?.content && typeof pages[0].content === "object" && !Array.isArray(pages[0].content)
      ? (pages[0].content as Record<string, unknown>).design
      : null;
    let design = embeddedDesign;
    if (!design) {
      const { data: templateRow } = await service.from("templates").select("id,name,genre,design_dna,is_system").eq("id", templateId).maybeSingle();
      design = runtimeDesignSnapshot(resolveRuntimeDesign(templateId, templateRow as TemplateDbRow | null));
    }

    return NextResponse.json({
      book: {
        id: book.id,
        title: book.title,
        subtitle: book.subtitle,
        bookType: book.book_type,
        status: book.status,
        targetPages: Number(book.target_pages),
        updatedAt: book.updated_at
      },
      pages,
      design,
      pageCount: pages.length,
      final: book.status === "COMPLETED"
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "BOOK_READER_FAILED";
    return jsonError(message, message === "UNAUTHORIZED" ? 401 : 500);
  }
}
