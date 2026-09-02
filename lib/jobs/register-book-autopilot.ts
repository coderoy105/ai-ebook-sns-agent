import { start } from "workflow/api";
import { createServiceSupabase } from "@/lib/supabase/server";
import { completeBookAutopilotWorkflow } from "@/lib/jobs/book-autopilot-workflow";

type RegistrationResult = {
  ok: true;
  background: true;
  reused: boolean;
  ready?: boolean;
  runId?: string;
  status: string;
  markerSaved?: boolean;
};

export async function registerBookAutopilot(bookId: string, userId: string): Promise<RegistrationResult> {
  const supabase = createServiceSupabase();
  const [{ data: book, error: bookError }, { data: settingsRows, error: settingsError }] = await Promise.all([
    supabase.from("books").select("id,status").eq("id", bookId).eq("user_id", userId).single(),
    supabase.from("book_settings").select("planning_input").eq("book_id", bookId).limit(1)
  ]);
  if (bookError || !book) throw new Error(bookError?.message ?? "BOOK_NOT_FOUND");
  if (settingsError) throw new Error(settingsError.message);

  const planningInput = settingsRows?.[0]?.planning_input && typeof settingsRows[0].planning_input === "object"
    ? settingsRows[0].planning_input as Record<string, unknown>
    : {};
  const existingRunId = typeof planningInput.autopilotRunId === "string" ? planningInput.autopilotRunId.trim() : "";
  const autopilotStatus = typeof planningInput.autopilotStatus === "string" ? planningInput.autopilotStatus : "";

  if (existingRunId && ["registered", "waiting", "handed-off", "completed"].includes(autopilotStatus)) {
    return { ok: true, background: true, reused: true, runId: existingRunId, status: autopilotStatus };
  }

  if (book.status === "COMPLETED") {
    return { ok: true, background: true, reused: true, ready: true, status: "completed" };
  }

  const run = await start(completeBookAutopilotWorkflow, [{ bookId, userId }]);
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

  return {
    ok: true,
    background: true,
    reused: false,
    runId: run.runId,
    status: "registered",
    markerSaved: !updateError
  };
}
