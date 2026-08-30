import { NextResponse } from "next/server";
import { z } from "zod";
import { start } from "workflow/api";
import { requireUser } from "@/lib/supabase/server";
import { hasBackgroundCredential } from "@/lib/ai/provider-connection";
import { normalizeBackgroundProvider } from "@/lib/ai/background-provider";
import { isTransientCodexError } from "@/lib/ai/transient-codex-errors";
import { generateFreeBlueprintWorkflow } from "@/lib/jobs/free-blueprint-workflow";
import { generateFreeBookWorkflow } from "@/lib/jobs/free-book-workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STALE_PLANNING_MS = 3 * 60 * 1000;
const STALE_GENERATION_MS = 30 * 1000;
const MAX_GENERATION_AUTO_RECOVERIES = 3;
const ACTIVE_PLANNING_STATUSES = ["QUEUED", "PLANNING", "RETRYING", "WAITING_LIMIT"];
const RECOVERABLE_PLANNING_FAILURES = new Set([
  "WORKER_ERROR",
  "CODEX_OUTPUT_SCHEMA_INVALID",
  "CODEX_GENERATION_FAILED"
]);
const GENERATION_RECOVERY_LOG = "일시적인 Codex 런타임 오류를 감지해 저장된 Section부터 자동 재개했습니다.";

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

type Relation<T> = T | T[] | null;
type SettingsRow = { planning_input?: unknown };
type SectionProgressRow = {
  id: string;
  title: string;
  status: string;
  word_count: number;
  target_words: number;
  chapter: Relation<{ title: string }>;
};
type JobRow = {
  id: string;
  status: string;
  progress: number | null;
  workflow_run_id: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string | null;
};
type LogRow = {
  id: string;
  level: string;
  message: string;
  metadata: unknown;
  created_at: string;
  generation_job_id: string | null;
};

function one<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function activityAgeMs(job: JobRow) {
  const timestamp = Date.parse(job.updated_at ?? job.created_at);
  return Number.isFinite(timestamp) ? Date.now() - timestamp : 0;
}

function isRecoverablePlanningJob(bookStatus: string, job: JobRow) {
  const stale = activityAgeMs(job) >= STALE_PLANNING_MS;
  const activeStale = bookStatus === "PLANNING"
    && ACTIVE_PLANNING_STATUSES.includes(job.status)
    && Number(job.progress ?? 0) <= 8
    && stale;
  const knownTechnicalFailure = bookStatus === "FAILED"
    && job.status === "PAUSED_ERROR"
    && Number(job.progress ?? 0) <= 12
    && RECOVERABLE_PLANNING_FAILURES.has(job.failure_reason ?? "")
    && stale;
  return activeStale || knownTechnicalFailure;
}

function generationRecoveryCount(job: JobRow, logs: LogRow[]) {
  return logs.filter((log) => log.generation_job_id === job.id && log.message === GENERATION_RECOVERY_LOG).length;
}

function hasRecoverableGenerationEvidence(job: JobRow, logs: LogRow[]) {
  if (job.failure_reason && isTransientCodexError(job.failure_reason)) return true;
  return logs.some((log) => log.generation_job_id === job.id && isTransientCodexError(log.message));
}

function isRecoverableGenerationJob(bookStatus: string, job: JobRow, logs: LogRow[]) {
  const recoverableState = job.status === "PAUSED_ERROR" || job.status === "NEEDS_RECONNECT";
  return bookStatus === "PAUSED"
    && recoverableState
    && Number(job.progress ?? 0) < 100
    && activityAgeMs(job) >= STALE_GENERATION_MS
    && generationRecoveryCount(job, logs) < MAX_GENERATION_AUTO_RECOVERIES
    && hasRecoverableGenerationEvidence(job, logs);
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await params;
    const { supabase, user } = await requireUser();

    const [{ data: book, error }, { data: jobs }, { data: logs }, { data: rawSections, error: sectionsError }] = await Promise.all([
      supabase.from("books")
        .select("id,user_id,status,progress,current_section_id,quality_score,quality_scores,book_settings(planning_input)")
        .eq("id", bookId)
        .single(),
      supabase.from("generation_jobs")
        .select("id,status,progress,workflow_run_id,failure_reason,created_at,updated_at")
        .eq("book_id", bookId)
        .order("created_at", { ascending: false })
        .limit(1),
      supabase.from("job_logs")
        .select("id,level,message,metadata,created_at,generation_job_id")
        .eq("book_id", bookId)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.from("sections")
        .select("id,title,status,word_count,target_words,chapter:chapters(title)")
        .eq("book_id", bookId)
    ]);

    if (error || !book || book.user_id !== user.id) {
      return NextResponse.json({ error: "Book not found." }, { status: 404 });
    }
    if (sectionsError) throw sectionsError;

    const settingsRelation = book.book_settings as unknown as Relation<SettingsRow>;
    const planningInput = PlanningInputSchema.safeParse(one(settingsRelation)?.planning_input);
    const provider = normalizeBackgroundProvider(planningInput.success ? planningInput.data.aiProvider : undefined);
    const logRows = (logs ?? []) as unknown as LogRow[];
    let latestJob = (jobs?.[0] ?? null) as JobRow | null;
    let bookStatus = String(book.status ?? "DRAFT");
    let recovery: { state: string; runId?: string; error?: string } | null = null;

    const recoverPlanning = latestJob !== null
      && planningInput.success
      && isRecoverablePlanningJob(bookStatus, latestJob);
    const recoverGeneration = latestJob !== null
      && planningInput.success
      && provider === "codex"
      && isRecoverableGenerationJob(bookStatus, latestJob, logRows);
    const shouldRecover = recoverPlanning || recoverGeneration;

    if (shouldRecover && latestJob && planningInput.success) {
      // A transient Codex RPC/Sandbox failure must not be converted into an auth
      // failure just because the separate status probe also times out. Restart the
      // saved generation first; the generation call itself will return an explicit
      // CODEX_CONNECTION_REQUIRED/EXPIRED if user authorization is truly gone.
      const credentialReady = recoverGeneration ? true : await hasBackgroundCredential(user.id, provider);
      if (!credentialReady) {
        const now = new Date().toISOString();
        await supabase.from("generation_jobs").update({
          status: "NEEDS_RECONNECT",
          updated_at: now
        }).eq("id", latestJob.id);
        latestJob = { ...latestJob, status: "NEEDS_RECONNECT", updated_at: now };
        recovery = { state: "needs-reconnect" };
      } else {
        const previousRunId = latestJob.workflow_run_id;
        const previousProgress = Number(latestJob.progress ?? 0);
        let claim = supabase.from("generation_jobs").update({
          status: "RETRYING",
          workflow_run_id: null,
          failure_reason: null,
          updated_at: new Date().toISOString()
        }).eq("id", latestJob.id).eq("status", latestJob.status);
        claim = previousRunId
          ? claim.eq("workflow_run_id", previousRunId)
          : claim.is("workflow_run_id", null);
        const { data: claimed, error: claimError } = await claim.select("id").maybeSingle();
        if (claimError) throw claimError;

        if (claimed) {
          try {
            if (recoverGeneration) {
              const run = await start(generateFreeBookWorkflow, [{
                bookId,
                userId: user.id,
                jobId: latestJob.id,
                provider
              }]);
              const now = new Date().toISOString();
              await Promise.all([
                supabase.from("generation_jobs").update({
                  workflow_run_id: run.runId,
                  status: "GENERATING",
                  progress: previousProgress,
                  failure_reason: null,
                  started_at: now,
                  updated_at: now
                }).eq("id", latestJob.id),
                supabase.from("books").update({ status: "GENERATING", updated_at: now }).eq("id", bookId),
                supabase.from("job_logs").insert({
                  generation_job_id: latestJob.id,
                  level: "warning",
                  message: GENERATION_RECOVERY_LOG
                })
              ]);
              latestJob = {
                ...latestJob,
                status: "GENERATING",
                progress: previousProgress,
                workflow_run_id: run.runId,
                failure_reason: null,
                updated_at: now
              };
              bookStatus = "GENERATING";
              recovery = { state: "recovered-generation", runId: run.runId };
            } else {
              const run = await start(generateFreeBlueprintWorkflow, [{
                bookId,
                userId: user.id,
                jobId: latestJob.id,
                form: planningInput.data
              }]);
              const now = new Date().toISOString();
              await Promise.all([
                supabase.from("generation_jobs").update({
                  workflow_run_id: run.runId,
                  status: "PLANNING",
                  progress: 8,
                  failure_reason: null,
                  started_at: now,
                  updated_at: now
                }).eq("id", latestJob.id),
                supabase.from("books").update({ status: "PLANNING", updated_at: now }).eq("id", bookId),
                supabase.from("job_logs").insert({
                  generation_job_id: latestJob.id,
                  level: "warning",
                  message: "중단된 Book Blueprint 작업을 감지해 최신 Workflow에서 자동 복구했습니다."
                })
              ]);
              latestJob = {
                ...latestJob,
                status: "PLANNING",
                progress: 8,
                workflow_run_id: run.runId,
                failure_reason: null,
                updated_at: now
              };
              bookStatus = "PLANNING";
              recovery = { state: "recovered", runId: run.runId };
            }
          } catch (caught) {
            const message = caught instanceof Error ? caught.message : "RECOVERY_FAILED";
            const now = new Date().toISOString();
            const failedBookStatus = recoverGeneration ? "PAUSED" : "FAILED";
            await Promise.all([
              supabase.from("generation_jobs").update({ status: "PAUSED_ERROR", failure_reason: message, updated_at: now }).eq("id", latestJob.id),
              supabase.from("books").update({ status: failedBookStatus, updated_at: now }).eq("id", bookId),
              supabase.from("job_logs").insert({
                generation_job_id: latestJob.id,
                level: "error",
                message: recoverGeneration ? `원고 생성 자동 복구 실패: ${message}` : `Book Blueprint 자동 복구 실패: ${message}`
              })
            ]);
            latestJob = { ...latestJob, status: "PAUSED_ERROR", failure_reason: message, workflow_run_id: null, updated_at: now };
            bookStatus = failedBookStatus;
            recovery = { state: "failed", error: message };
          }
        } else {
          recovery = { state: "claimed-by-another-request" };
        }
      }
    }

    const sections = (rawSections ?? []) as unknown as SectionProgressRow[];
    const totalSections = sections.length;
    const completedSections = sections.filter((section) => section.status === "COMPLETED").length;
    const generatedWords = sections.reduce((sum, section) => sum + Number(section.word_count || 0), 0);
    const targetWords = sections.reduce((sum, section) => sum + Number(section.target_words || 0), 0);
    const current = sections.find((section) => section.id === book.current_section_id) ?? null;
    const calculatedProgress = totalSections > 0 ? (completedSections / totalSections) * 100 : Number(book.progress ?? 0);
    const planningProgress = bookStatus === "PLANNING" && latestJob ? Number(latestJob.progress ?? 0) : 0;
    const effectiveProgress = bookStatus === "COMPLETED"
      ? 100
      : bookStatus === "PLANNING"
        ? Math.max(Number(book.progress ?? 0), planningProgress)
        : Math.max(Number(book.progress ?? 0), calculatedProgress);

    const { book_settings: _bookSettings, user_id: _userId, ...bookPayload } = book;
    void _bookSettings;
    void _userId;

    return NextResponse.json({
      book: { ...bookPayload, status: bookStatus, progress: effectiveProgress },
      aiProvider: provider,
      aiModel: provider === "codex" ? "gpt-5.6-luna" : "openrouter/free",
      progressDetails: {
        completedSections,
        totalSections,
        generatedWords,
        targetWords,
        currentSectionTitle: current?.title ?? null,
        currentChapterTitle: current ? one(current.chapter)?.title ?? null : null
      },
      job: latestJob,
      logs: logRows,
      recovery
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Book status failed.";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}
