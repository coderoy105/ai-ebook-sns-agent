import { sleep } from "workflow";
import { createServiceSupabase } from "@/lib/supabase/server";
import { normalizeBackgroundProvider, type BackgroundAiProvider } from "@/lib/ai/background-provider";

type AutopilotInput = { bookId: string; userId: string };

type InspectResult = {
  state: "wait" | "start" | "handed-off" | "completed" | "intervention";
  provider: BackgroundAiProvider;
  planningJobId: string | null;
  waitFor: string;
  reason: string;
};

type AutopilotStepRequest =
  | { action: "inspect"; input: AutopilotInput }
  | { action: "start"; input: AutopilotInput; provider: BackgroundAiProvider; planningJobId: string | null }
  | { action: "mark"; input: AutopilotInput; status: string; message: string };

type AutopilotStepResult = InspectResult | { ok: true; started?: boolean; runId?: string | null };

/**
 * Durable server-side handoff from Blueprint planning to full manuscript writing.
 * Once this workflow is registered, no browser tab, polling loop or powered-on
 * phone is required for the handoff to happen.
 */
export async function completeBookAutopilotWorkflow(input: AutopilotInput) {
  "use workflow";

  await autopilotStep({
    action: "mark",
    input,
    status: "waiting",
    message: "전체 책 자동 생성이 서버에 등록되었습니다. 휴대폰을 끄거나 브라우저를 닫아도 Book Blueprint 이후 원고 집필까지 자동으로 이어집니다."
  });

  while (true) {
    const inspection = await autopilotStep({ action: "inspect", input }) as InspectResult;

    if (inspection.state === "completed") {
      await autopilotStep({ action: "mark", input, status: "completed", message: "전체 책 자동 생성이 완료되었습니다." });
      return { status: "completed", bookId: input.bookId };
    }

    if (inspection.state === "handed-off") {
      await autopilotStep({ action: "mark", input, status: "handed-off", message: "원고 생성 Workflow가 이미 서버에서 실행 중입니다." });
      return { status: "handed-off", bookId: input.bookId };
    }

    if (inspection.state === "intervention") {
      await autopilotStep({ action: "mark", input, status: "intervention", message: inspection.reason });
      return { status: "intervention", bookId: input.bookId, reason: inspection.reason };
    }

    if (inspection.state === "start") {
      const started = await autopilotStep({
        action: "start",
        input,
        provider: inspection.provider,
        planningJobId: inspection.planningJobId
      }) as { ok: true; started?: boolean; runId?: string | null };
      await autopilotStep({
        action: "mark",
        input,
        status: "handed-off",
        message: started.started
          ? "Book Blueprint가 완료되어 서버가 전체 원고 생성을 자동으로 시작했습니다."
          : "전체 원고 생성 Workflow가 이미 등록되어 있어 기존 작업을 그대로 사용합니다."
      });
      return { status: "handed-off", bookId: input.bookId, runId: started.runId ?? null };
    }

    await sleep(inspection.waitFor);
  }
}

async function autopilotStep(request: AutopilotStepRequest): Promise<AutopilotStepResult> {
  "use step";

  if (request.action === "inspect") return inspectBook(request.input);
  if (request.action === "start") {
    const { startAutomaticBookGeneration } = await import("@/lib/jobs/auto-book-generation");
    const result = await startAutomaticBookGeneration({
      bookId: request.input.bookId,
      userId: request.input.userId,
      planningJobId: request.planningJobId ?? "00000000-0000-0000-0000-000000000000",
      provider: request.provider
    });
    return { ok: true, started: result.started, runId: result.runId };
  }

  await markAutopilot(request.input, request.status, request.message);
  return { ok: true };
}

async function inspectBook(input: AutopilotInput): Promise<InspectResult> {
  const supabase = createServiceSupabase();
  const [{ data: book, error: bookError }, { data: sectionRows, error: sectionError }, { data: jobs, error: jobsError }, { data: settingsRows, error: settingsError }] = await Promise.all([
    supabase.from("books").select("id,status").eq("id", input.bookId).eq("user_id", input.userId).single(),
    supabase.from("sections").select("id").eq("book_id", input.bookId),
    supabase.from("generation_jobs").select("id,status,workflow_run_id,failure_reason,created_at").eq("book_id", input.bookId).eq("user_id", input.userId).order("created_at", { ascending: false }).limit(2),
    supabase.from("book_settings").select("planning_input").eq("book_id", input.bookId).limit(1)
  ]);
  if (bookError || !book) throw new Error(bookError?.message ?? "BOOK_NOT_FOUND");
  if (sectionError) throw new Error(sectionError.message);
  if (jobsError) throw new Error(jobsError.message);
  if (settingsError) throw new Error(settingsError.message);

  const sectionCount = Array.isArray(sectionRows) ? sectionRows.length : 0;
  const planningInput = settingsRows?.[0]?.planning_input && typeof settingsRows[0].planning_input === "object"
    ? settingsRows[0].planning_input as Record<string, unknown>
    : {};
  const provider = normalizeBackgroundProvider(planningInput.aiProvider);
  const latestJob = jobs?.[0] ?? null;
  const latestStatus = String(latestJob?.status ?? "");
  const status = String(book.status);

  if (status === "COMPLETED") {
    return { state: "completed", provider, planningJobId: latestJob?.id ?? null, waitFor: "30s", reason: "" };
  }

  if (status === "GENERATING" || (["GENERATING", "QUEUED"].includes(latestStatus) && sectionCount > 0)) {
    return { state: "handed-off", provider, planningJobId: latestJob?.id ?? null, waitFor: "30s", reason: "" };
  }

  if (latestStatus === "NEEDS_RECONNECT") {
    return { state: "intervention", provider, planningJobId: latestJob?.id ?? null, waitFor: "30s", reason: "AI 계정 연결이 만료되어 자동 생성이 대기 중입니다. 다시 연결하면 저장된 위치에서 이어집니다." };
  }

  if (["PAUSED_ERROR", "FAILED"].includes(latestStatus) || status === "FAILED") {
    return { state: "intervention", provider, planningJobId: latestJob?.id ?? null, waitFor: "30s", reason: latestJob?.failure_reason ? `AI 제공자 오류로 자동 생성이 일시정지되었습니다: ${latestJob.failure_reason}` : "AI 제공자 오류로 자동 생성이 일시정지되었습니다." };
  }

  if (status === "CANCELLED") {
    return { state: "intervention", provider, planningJobId: latestJob?.id ?? null, waitFor: "30s", reason: "사용자가 책 생성을 취소했습니다." };
  }

  if ((status === "DRAFT" || status === "PAUSED") && sectionCount > 0) {
    return { state: "start", provider, planningJobId: latestJob?.id ?? null, waitFor: "15s", reason: "" };
  }

  const waitFor = latestStatus === "WAITING_LIMIT"
    ? (provider === "codex" ? "1h" : "24h")
    : latestStatus === "RETRYING"
      ? "2m"
      : "30s";
  return { state: "wait", provider, planningJobId: latestJob?.id ?? null, waitFor, reason: "Blueprint 완료를 기다리는 중" };
}

async function markAutopilot(input: AutopilotInput, status: string, message: string) {
  const supabase = createServiceSupabase();
  const { data: settingsRows } = await supabase.from("book_settings").select("planning_input").eq("book_id", input.bookId).limit(1);
  const planningInput = settingsRows?.[0]?.planning_input && typeof settingsRows[0].planning_input === "object"
    ? settingsRows[0].planning_input as Record<string, unknown>
    : {};
  await supabase.from("book_settings").update({
    planning_input: {
      ...planningInput,
      autopilotStatus: status,
      autopilotMessage: message,
      autopilotUpdatedAt: new Date().toISOString()
    }
  }).eq("book_id", input.bookId);
}
