import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { requireUser } from "@/lib/supabase/server";
import { completeBookAutopilotWorkflow } from "@/lib/jobs/book-autopilot-workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await context.params;
    const { supabase, user } = await requireUser();

    const [{ data: book, error: bookError }, { data: settingsRows, error: settingsError }] = await Promise.all([
      supabase.from("books").select("id,status").eq("id", bookId).eq("user_id", user.id).single(),
      supabase.from("book_settings").select("planning_input").eq("book_id", bookId).limit(1)
    ]);
    if (bookError || !book) return response({ error: "Book not found" }, 404);
    if (settingsError) throw settingsError;

    const planningInput = settingsRows?.[0]?.planning_input && typeof settingsRows[0].planning_input === "object"
      ? settingsRows[0].planning_input as Record<string, unknown>
      : {};
    const existingRunId = typeof planningInput.autopilotRunId === "string" ? planningInput.autopilotRunId.trim() : "";
    const autopilotStatus = typeof planningInput.autopilotStatus === "string" ? planningInput.autopilotStatus : "";

    if (existingRunId && ["registered", "waiting", "handed-off", "completed"].includes(autopilotStatus)) {
      return response({ ok: true, background: true, reused: true, runId: existingRunId, status: autopilotStatus });
    }

    if (book.status === "COMPLETED") {
      return response({ ok: true, background: true, reused: true, ready: true, status: "completed" });
    }

    const run = await start(completeBookAutopilotWorkflow, [{ bookId, userId: user.id }]);
    const now = new Date().toISOString();
    const { error: updateError } = await supabase.from("book_settings").update({
      planning_input: {
        ...planningInput,
        autopilotRunId: run.runId,
        autopilotStatus: "registered",
        autopilotMessage: "서버가 Blueprint 완료 후 전체 원고 집필까지 자동으로 이어갑니다.",
        autopilotRegisteredAt: now,
        autopilotUpdatedAt: now
      }
    }).eq("book_id", bookId);

    // The Workflow has already been registered. Do not turn a bookkeeping write
    // failure into a duplicate workflow registration on a client retry.
    return response({
      ok: true,
      background: true,
      reused: false,
      runId: run.runId,
      status: "registered",
      markerSaved: !updateError
    }, 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AUTOPILOT_REGISTRATION_FAILED";
    return response({ error: message }, message === "UNAUTHORIZED" ? 401 : 400);
  }
}
