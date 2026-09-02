import { backgroundProviderLabel, type BackgroundAiProvider } from "@/lib/ai/background-provider";
import { createServiceSupabase } from "@/lib/supabase/server";

type AutoGenerationInput = {
  bookId: string;
  userId: string;
  planningJobId: string;
  provider: BackgroundAiProvider;
};

type GenerationJob = {
  id: string;
  status: string;
  workflow_run_id: string | null;
};

const ACTIVE_GENERATION_STATUSES = ["QUEUED", "GENERATING", "WAITING_LIMIT", "PAUSED", "NEEDS_RECONNECT"];

export type AutoGenerationResult = {
  started: boolean;
  jobId: string;
  runId: string | null;
  reused: boolean;
};

/**
 * Starts manuscript generation from the server after Blueprint planning finishes.
 * This function is intentionally browser-independent: the user's phone, tab and
 * network connection are not involved once the original book-create request has
 * registered the Blueprint workflow.
 */
export async function startAutomaticBookGeneration(input: AutoGenerationInput): Promise<AutoGenerationResult> {
  const supabase = createServiceSupabase();

  const { data: book, error: bookError } = await supabase.from("books")
    .select("id,status")
    .eq("id", input.bookId)
    .eq("user_id", input.userId)
    .single();
  if (bookError || !book) throw new Error(bookError?.message ?? "BOOK_NOT_FOUND");

  if (book.status === "COMPLETED") {
    return { started: false, jobId: input.planningJobId, runId: null, reused: true };
  }

  const { data: existingRows, error: existingError } = await supabase.from("generation_jobs")
    .select("id,status,workflow_run_id")
    .eq("book_id", input.bookId)
    .eq("user_id", input.userId)
    .neq("id", input.planningJobId)
    .in("status", ACTIVE_GENERATION_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1);
  if (existingError) throw new Error(existingError.message);

  let job = (existingRows?.[0] ?? null) as GenerationJob | null;
  if (job?.workflow_run_id) {
    return { started: false, jobId: job.id, runId: job.workflow_run_id, reused: true };
  }

  if (!job) {
    const { data: created, error: createError } = await supabase.from("generation_jobs").insert({
      book_id: input.bookId,
      user_id: input.userId,
      status: "QUEUED",
      progress: 0,
      started_at: new Date().toISOString()
    }).select("id,status,workflow_run_id").single();
    if (createError || !created) throw new Error(createError?.message ?? "GENERATION_JOB_CREATE_FAILED");
    job = created as GenerationJob;
  }

  await supabase.from("job_logs").insert({
    generation_job_id: job.id,
    level: "info",
    message: `Book Blueprint 완료 · ${backgroundProviderLabel(input.provider)}가 서버에서 전체 원고 생성을 자동으로 이어갑니다. 휴대폰을 끄거나 브라우저를 닫아도 계속됩니다.`
  });

  // Keep workflow/api and the manuscript workflow out of the Blueprint workflow
  // bundle. This code runs only inside a server-side `use step` invocation.
  const [{ start }, { generateFreeBookWorkflow }] = await Promise.all([
    import("workflow/api"),
    import("@/lib/jobs/free-book-workflow")
  ]);
  const run = await start(generateFreeBookWorkflow, [{
    bookId: input.bookId,
    userId: input.userId,
    jobId: job.id,
    provider: input.provider
  }]);

  // The child workflow itself updates this same job immediately. If this
  // bookkeeping write ever fails after start(), do not throw and accidentally
  // create a duplicate child workflow on a step retry.
  await Promise.allSettled([
    supabase.from("generation_jobs").update({
      workflow_run_id: run.runId,
      status: "GENERATING",
      failure_reason: null,
      updated_at: new Date().toISOString()
    }).eq("id", job.id),
    supabase.from("books").update({ status: "GENERATING" }).eq("id", input.bookId).eq("user_id", input.userId)
  ]);

  return { started: true, jobId: job.id, runId: run.runId, reused: false };
}
