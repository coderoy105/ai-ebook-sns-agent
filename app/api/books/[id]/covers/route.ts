import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { createCoverConcepts } from "@/lib/design/cover-system";

type UserSupabase = Awaited<ReturnType<typeof requireUser>>["supabase"];
type LoadedCoverData = NonNullable<Awaited<ReturnType<typeof loadBookAndCovers>>>;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

async function loadBookAndCovers(bookId: string, userId: string, supabase: UserSupabase) {
  const { data: book, error: bookError } = await supabase.from("books")
    .select("id,title,subtitle,idea,book_type,updated_at")
    .eq("id", bookId)
    .eq("user_id", userId)
    .single();
  if (bookError || !book) return null;

  const { data: covers, error: coverError } = await supabase.from("book_covers")
    .select("id,concept,is_selected,created_at")
    .eq("book_id", bookId)
    .order("created_at", { ascending: false });
  if (coverError) throw coverError;
  return { book, covers: covers ?? [] };
}

function modernCoverCount(loaded: LoadedCoverData) {
  return loaded.covers.filter((cover) => cover.concept && typeof cover.concept === "object" && (cover.concept as { version?: unknown }).version === 2).length;
}

async function blueprintCoreMessage(bookId: string, supabase: UserSupabase) {
  const { data: blueprintRow } = await supabase.from("book_blueprints")
    .select("blueprint")
    .eq("book_id", bookId)
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  const blueprint = blueprintRow?.blueprint && typeof blueprintRow.blueprint === "object"
    ? blueprintRow.blueprint as Record<string, unknown>
    : {};
  return typeof blueprint.coreMessage === "string" ? blueprint.coreMessage : null;
}

async function replaceWithGeneratedCovers(bookId: string, loaded: LoadedCoverData, supabase: UserSupabase, generation: number) {
  const coreMessage = await blueprintCoreMessage(bookId, supabase);
  const concepts = createCoverConcepts({
    title: String(loaded.book.title),
    subtitle: loaded.book.subtitle ? String(loaded.book.subtitle) : null,
    bookType: loaded.book.book_type ? String(loaded.book.book_type) : null,
    idea: loaded.book.idea ? String(loaded.book.idea) : null,
    coreMessage
  }, generation);
  const { error: deleteError } = await supabase.from("book_covers").delete().eq("book_id", bookId);
  if (deleteError) throw deleteError;
  const { error: insertError } = await supabase.from("book_covers").insert(concepts.map((concept, index) => ({
    book_id: bookId,
    concept,
    is_selected: index === 0
  })));
  if (insertError) throw insertError;
}

async function ensureModernCovers(bookId: string, userId: string, supabase: UserSupabase) {
  let loaded = await loadBookAndCovers(bookId, userId, supabase);
  if (!loaded) return null;
  if (modernCoverCount(loaded) >= 3) return loaded;
  await replaceWithGeneratedCovers(bookId, loaded, supabase, 0);
  loaded = await loadBookAndCovers(bookId, userId, supabase);
  return loaded;
}

async function responseCovers(bookId: string, userId: string, supabase: UserSupabase) {
  const loaded = await ensureModernCovers(bookId, userId, supabase);
  if (!loaded) return jsonError("Book not found", 404);
  const selected = loaded.covers.find((cover) => cover.is_selected);
  const visible = selected
    ? [selected, ...loaded.covers.filter((cover) => cover.id !== selected.id)].slice(0, 3)
    : loaded.covers.slice(0, 3);
  return NextResponse.json({ covers: visible }, { headers: { "cache-control": "no-store" } });
}

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { supabase, user } = await requireUser();
    return responseCovers(id, user.id, supabase);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cover load failed";
    return jsonError(message, message === "UNAUTHORIZED" ? 401 : 400);
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const { supabase, user } = await requireUser();
    let loaded = await ensureModernCovers(id, user.id, supabase);
    if (!loaded) return jsonError("Book not found", 404);
    const body = await request.json().catch(() => ({})) as { action?: string; coverId?: string };

    if (body.action === "select") {
      if (!body.coverId) return jsonError("coverId is required");
      const cover = loaded.covers.find((item) => item.id === body.coverId);
      if (!cover) return jsonError("Cover not found", 404);
      const { error: clearError } = await supabase.from("book_covers").update({ is_selected: false }).eq("book_id", id);
      if (clearError) throw clearError;
      const { error: selectError } = await supabase.from("book_covers").update({ is_selected: true }).eq("id", body.coverId).eq("book_id", id);
      if (selectError) throw selectError;
      const { error: touchError } = await supabase.from("books").update({ updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id);
      if (touchError) throw touchError;
      return responseCovers(id, user.id, supabase);
    }

    if (body.action === "regenerate") {
      const generation = Math.max(1, Math.max(...loaded.covers.map((cover) => {
        if (!cover.concept || typeof cover.concept !== "object") return 0;
        return Number((cover.concept as { generation?: unknown }).generation ?? 0);
      }), 0) + 1);
      await replaceWithGeneratedCovers(id, loaded, supabase, generation);
      const { error: touchError } = await supabase.from("books").update({ updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", user.id);
      if (touchError) throw touchError;
      loaded = await loadBookAndCovers(id, user.id, supabase);
      if (!loaded) return jsonError("Book not found", 404);
      return responseCovers(id, user.id, supabase);
    }

    return jsonError("Unsupported cover action");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cover action failed";
    return jsonError(message, message === "UNAUTHORIZED" ? 401 : 400);
  }
}
