import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { generateFreeBookWorkflow } from "@/lib/jobs/free-book-workflow";
import { createServiceSupabase, requireUser } from "@/lib/supabase/server";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { backgroundProviderLabel, hasBackgroundCredential, normalizeBackgroundProvider } from "@/lib/ai/background-provider";

const activeStatuses = ["QUEUED", "GENERATING", "WAITING_LIMIT", "PAUSED"];

type SettingsRelation = { planning_input?: { aiProvider?: unknown } | null } | Array<{ planning_input?: { aiProvider?: unknown } | null }> | null;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireUser();
    await assertRateLimit(user.id, "book-generate", 12, 3600);

    const { data: book, error } = await supabase.from("books")
      .select("id,user_id,status,progress,book_settings(planning_input)")
      .eq("id", id)
      .single();
    if (error || !book || book.user_id !== user.id) return NextResponse.json({ error: "Book not found." }, { status: 404 });
    if (book.status === "COMPLETED") return NextResponse.json({ done: true, progress: 100 });

    const settingsRelation = book.book_settings as unknown as SettingsRelation;
    const settings = Array.isArray(settingsRelation) ? settingsRelation[0] : settingsRelation;
    const provider = normalizeBackgroundProvider(settings?.planning_input?.aiProvider);
    const service = createServiceSupabase();

    if (provider === "openrouter") {
      const requestKey = request.headers.get("x-openrouter-key")?.trim();
      if (requestKey && requestKey.length >= 16) {
        const { error: saveError } = await service.rpc("store_openrouter_credential", { p_user_id: user.id, p_secret: requestKey });
        if (saveError) throw new Error(saveError.message);
      }
    }

    const hasCredential = await hasBackgroundCredential(user.id, provider);
    if (!hasCredential) {
      return NextResponse.json({
        error: provider === "codex" ? "CODEX_CONNECTION_REQUIRED" : "FREE_AI_CONNECTION_REQUIRED",
        reconnect: true,
        provider
      }, { status: 428 });
    }

    if (provider === "codex") {
      const { data: profile, error: profileError } = await service.from("codex_connection_profiles")
        .select("model_available")
        .eq("user_id", user.id)
        .maybeSingle();
      if (profileError) throw new Error(profileError.message);
      if (profile?.model_available === false) return NextResponse.json({ error: "CODEX_LUNA_UNAVAILABLE", provider }, { status: 409 });
    }

    const { data: activeJobs } = await supabase.from("generation_jobs")
      .select("id,status,progress,workflow_run_id,created_at")
      .eq("book_id", id)
      .in("status", activeStatuses)
      .order("created_at", { ascending: false })
      .limit(1);
    const activeJob = activeJobs?.[0];
    if (activeJob?.workflow_run_id) {
      if (book.status === "PAUSED") await supabase.from("books").update({ status: "GENERATING" }).eq("id", id);
      return NextResponse.json({
        jobId: activeJob.id,
        runId: activeJob.workflow_run_id,
        progress: Number(activeJob.progress ?? book.progress ?? 0),
        background: true,
        alreadyRunning: true,
        provider
      });
    }

    const { data: job, error: jobError } = await supabase.from("generation_jobs").insert({
      book_id: id,
      user_id: user.id,
      status: "QUEUED",
      progress: Number(book.progress ?? 0),
      started_at: new Date().toISOString()
    }).select("id").single();
    if (jobError || !job) throw jobError ?? new Error("GENERATION_JOB_CREATE_FAILED");

    const run = await start(generateFreeBookWorkflow, [{ bookId: id, userId: user.id, jobId: job.id, provider }]);
    const providerLabel = backgroundProviderLabel(provider);
    await Promise.all([
      supabase.from("generation_jobs").update({ workflow_run_id: run.runId, status: "GENERATING" }).eq("id", job.id),
      supabase.from("books").update({ status: "GENERATING" }).eq("id", id),
      supabase.from("job_logs").insert({ generation_job_id: job.id, level: "info", message: `${providerLabel} 백그라운드 생성 작업이 등록되었습니다. 화면을 나가도 계속 진행됩니다.` })
    ]);

    return NextResponse.json({ jobId: job.id, runId: run.runId, background: true, alreadyRunning: false, provider });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "RATE_LIMITED" ? 429 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
