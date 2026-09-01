import { sleep } from "workflow";

type Input = { bookId: string; userId: string };
type TitleState = { waiting: boolean; title: string | null };

export async function applyTitleOverrideWorkflow(input: Input) {
  "use workflow";

  // Planning can pause for provider limits. Stay durable without holding a function open.
  for (let attempt = 0; attempt < 576; attempt += 1) {
    const state = await titleOverrideStep({ action: "inspect", input }) as TitleState;
    if (!state.title) return { status: "no-override", bookId: input.bookId };
    if (!state.waiting) {
      await titleOverrideStep({ action: "apply", input });
      return { status: "applied", bookId: input.bookId };
    }
    await sleep("5m");
  }

  // The latest title remains stored in planning_input even if an unusually long planning job exceeds the watch window.
  return { status: "watch-expired", bookId: input.bookId };
}

type StepRequest =
  | { action: "inspect"; input: Input }
  | { action: "apply"; input: Input };

async function titleOverrideStep(request: StepRequest): Promise<TitleState | { ok: true }> {
  "use step";

  const { createServiceSupabase } = await import("@/lib/supabase/server");
  const supabase = createServiceSupabase();
  const { data: book, error: bookError } = await supabase.from("books")
    .select("id,user_id,status,book_settings(planning_input),book_blueprints(id,blueprint,is_active,version)")
    .eq("id", request.input.bookId)
    .eq("user_id", request.input.userId)
    .maybeSingle();
  if (bookError) throw new Error(bookError.message);
  if (!book) return request.action === "inspect" ? { waiting: false, title: null } : { ok: true };

  const settingsRelation = book.book_settings as unknown as { planning_input?: unknown } | Array<{ planning_input?: unknown }> | null;
  const settings = Array.isArray(settingsRelation) ? settingsRelation[0] : settingsRelation;
  const planning = settings?.planning_input && typeof settings.planning_input === "object"
    ? settings.planning_input as Record<string, unknown>
    : {};
  const title = typeof planning.titleOverride === "string" ? planning.titleOverride.trim() : "";

  if (request.action === "inspect") {
    return { waiting: String(book.status) === "PLANNING", title: title || null };
  }
  if (!title) return { ok: true };

  const now = new Date().toISOString();
  const { error: titleError } = await supabase.from("books")
    .update({ title, updated_at: now })
    .eq("id", request.input.bookId)
    .eq("user_id", request.input.userId);
  if (titleError) throw new Error(titleError.message);

  const blueprintRows = (Array.isArray(book.book_blueprints) ? book.book_blueprints : book.book_blueprints ? [book.book_blueprints] : []) as Array<{
    id?: string;
    blueprint?: unknown;
    is_active?: boolean;
    version?: number;
  }>;
  blueprintRows.sort((a, b) => Number(b.version ?? 0) - Number(a.version ?? 0));
  const active = blueprintRows.find((row) => row.is_active !== false) ?? blueprintRows[0];
  if (active?.id && active.blueprint && typeof active.blueprint === "object") {
    const { error } = await supabase.from("book_blueprints")
      .update({ blueprint: { ...(active.blueprint as Record<string, unknown>), selectedTitle: title } })
      .eq("id", active.id)
      .eq("book_id", request.input.bookId);
    if (error) throw new Error(error.message);
  }

  const { data: coverPage, error: coverError } = await supabase.from("pages")
    .select("id,content")
    .eq("book_id", request.input.bookId)
    .eq("layout_type", "Cover")
    .order("page_number", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (coverError) throw new Error(coverError.message);
  if (coverPage?.id && coverPage.content && typeof coverPage.content === "object") {
    const { error } = await supabase.from("pages")
      .update({ content: { ...(coverPage.content as Record<string, unknown>), title } })
      .eq("id", coverPage.id);
    if (error) throw new Error(error.message);
  }

  return { ok: true };
}
