import { NextResponse } from "next/server";
import { z } from "zod";
import { start } from "workflow/api";
import { createServiceSupabase, requireUser } from "@/lib/supabase/server";
import { generateFreeBlueprintWorkflow } from "@/lib/jobs/free-blueprint-workflow";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { backgroundProviderLabel, hasBackgroundCredential, normalizeBackgroundProvider } from "@/lib/ai/background-provider";

const PlanningInputSchema = z.object({
  idea: z.string().min(8).max(8000),
  bookType: z.string().min(2).max(100),
  audience: z.string().min(2).max(500),
  ageGroup: z.string().min(1).max(100),
  knowledgeLevel: z.enum(["beginner", "intermediate", "advanced", "expert"]),
  tone: z.string().min(2).max(500),
  targetPages: z.number().int().min(10).max(800),
  targetWords: z.number().int().positive(),
  templateMood: z.string().min(2).max(100),
  mode: z.enum(["quick", "advanced"]),
  aiProvider: z.enum(["openrouter", "codex"]).default("openrouter")
});

const activePlanningStatuses = ["QUEUED", "PLANNING", "RETRYING", "WAITING_LIMIT"];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;
    const { supabase, user } = await requireUser();
    await assertRateLimit(user.id, "book-plan-resume", 12, 3600);

    const { data: book, error: bookError } = await supabase.from("books")
      .select("id,user_id,status,book_settings(planning_input)")
      .eq("id", bookId)
      .single();
    if (bookError || !book || book.user_id !== user.id) return NextResponse.json({ error: "Book not found." }, { status: 404 });

    const settingsRelation = book.book_settings as unknown as { planning_input?: unknown } | Array<{ planning_input?: unknown }> | null;
    const settings = Array.isArray(settingsRelation) ? settingsRelation[0] : settingsRelation;
    const planningInput = PlanningInputSchema.parse(settings?.planning_input);
    const provider = normalizeBackgroundProvider(planningInput.aiProvider);

    const service = createServiceSupabase();
    if (provider === "openrouter") {
      const requestKey = request.headers.get("x-openrouter-key")?.trim();
      if (requestKey && requestKey.length >= 16) {
        const { error: saveError } = await service.rpc("store_openrouter_credential", { p_user_id: user.id, p_secret: requestKey });
        if (saveError) throw new Error(saveError.message);
      }
    }

    const connected = await hasBackgroundCredential(user.id, provider);
    if (!connected) {
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
      .eq("book_id", bookId)
      .in("status", activePlanningStatuses)
      .order("created_at", { ascending: false })
      .limit(1);
    const active = activeJobs?.[0];
    if (active?.workflow_run_id) {
      return NextResponse.json({ jobId: active.id, runId: active.workflow_run_id, background: true, alreadyRunning: true, provider });
    }

    const { data: job, error: jobError } = await supabase.from("generation_jobs").insert({
      book_id: bookId,
      user_id: user.id,
      status: "QUEUED",
      progress: 8,
      started_at: new Date().toISOString()
    }).select("id").single();
    if (jobError || !job) throw jobError ?? new Error("PLANNING_JOB_CREATE_FAILED");

    await supabase.from("books").update({ status: "PLANNING" }).eq("id", bookId);
    const run = await start(generateFreeBlueprintWorkflow, [{ bookId, userId: user.id, jobId: job.id, form: planningInput }]);
    const providerLabel = backgroundProviderLabel(provider);
    await Promise.all([
      supabase.from("generation_jobs").update({ workflow_run_id: run.runId, status: "PLANNING" }).eq("id", job.id),
      supabase.from("job_logs").insert({ generation_job_id: job.id, level: "info", message: `저장된 프로젝트에서 ${providerLabel} Book Blueprint 백그라운드 생성을 재개했습니다.` })
    ]);

    return NextResponse.json({ jobId: job.id, runId: run.runId, background: true, alreadyRunning: false, provider });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Planning resume failed.";
    const status = message === "UNAUTHORIZED" ? 401 : message === "RATE_LIMITED" ? 429 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
