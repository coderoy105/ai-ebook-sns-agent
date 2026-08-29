import { NextResponse } from "next/server";
import { z } from "zod";
import { start } from "workflow/api";
import { createServiceSupabase, requireUser } from "@/lib/supabase/server";
import { registerViaServiceBridge, serviceBridgeHealth } from "@/lib/supabase/service-bridge";
import { computeWordBudget, getBookTypeRule } from "@/lib/book-types/engine";
import { ReaderProfileSchema, WritingStyleSchema } from "@/lib/ai/schemas";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { generateFreeBlueprintWorkflow } from "@/lib/jobs/free-blueprint-workflow";
import { generateFreeBookWorkflow } from "@/lib/jobs/free-book-workflow";
import {
  backgroundProviderLabel,
  hasBackgroundCredential,
  normalizeBackgroundProvider
} from "@/lib/ai/background-provider";
import { collectBook, bookToMarkdown, stripMarkdown } from "@/lib/export/collect";
import { renderBookPdf } from "@/lib/export/pdf";
import { renderBookEpub } from "@/lib/export/epub";
import { renderBookDocx } from "@/lib/export/docx";
import {
  handleEditorGET,
  handleEditorPATCH,
  handleEditorPOST,
  handleEditorDELETE
} from "@/lib/api/editor-handlers";
import {
  handleAiConnectionGET,
  handleAiConnectionPOST,
  handleAiConnectionDELETE
} from "@/lib/api/ai-connection-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CreateBookSchema = z.object({
  idea: z.string().min(8).max(8000),
  bookType: z.string().min(2).max(100),
  audience: z.string().min(2).max(500),
  ageGroup: z.string().min(1).max(100),
  knowledgeLevel: z.enum(["beginner", "intermediate", "advanced", "expert"]),
  tone: z.string().min(2).max(500),
  targetPages: z.number().int().min(10).max(800),
  templateMood: z.string().min(2).max(100),
  mode: z.enum(["quick", "advanced"]).default("quick"),
  aiProvider: z.enum(["openrouter", "codex"]).default("openrouter")
});

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

const OpenRouterExchangeSchema = z.object({
  code: z.string().min(8).max(1000),
  verifier: z.string().min(20).max(1000)
});

type OpenRouterExchange = { key?: string; error?: { message?: string } };
type SettingsRelation = { planning_input?: { aiProvider?: unknown } | null } | Array<{ planning_input?: { aiProvider?: unknown } | null }> | null;

const activeGenerationStatuses = ["QUEUED", "GENERATING", "WAITING_LIMIT", "PAUSED"];
const activePlanningStatuses = ["QUEUED", "PLANNING", "RETRYING", "WAITING_LIMIT"];
const exportFormats = {
  pdf: { type: "application/pdf", ext: "pdf" },
  epub: { type: "application/epub+zip", ext: "epub" },
  docx: { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" },
  md: { type: "text/markdown; charset=utf-8", ext: "md" },
  txt: { type: "text/plain; charset=utf-8", ext: "txt" }
} as const;

type ExportFormat = keyof typeof exportFormats;

function pathOf(params: Promise<{ path: string[] }>) {
  return params.then((value) => value.path ?? []);
}

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function inferReaderProfile(input: z.infer<typeof CreateBookSchema>) {
  return ReaderProfileSchema.parse({
    ageGroup: input.ageGroup,
    knowledgeLevel: input.knowledgeLevel,
    readingPurpose: `Read and apply: ${input.idea}`,
    preferredComplexity: input.knowledgeLevel === "beginner" ? 4 : input.knowledgeLevel === "intermediate" ? 6 : 8,
    tonePreference: input.tone,
    technicalTolerance: input.knowledgeLevel === "beginner" ? 4 : 7,
    examplePreference: "concrete and relevant",
    readingSpeed: "average"
  });
}

function inferWritingStyle(input: z.infer<typeof CreateBookSchema>) {
  return WritingStyleSchema.parse({
    label: input.tone,
    description: input.tone,
    sentenceLength: input.ageGroup.includes("중") || input.ageGroup.includes("초") ? 4 : 6,
    descriptionDepth: 6,
    emotionLevel: input.bookType.includes("소설") || input.bookType.includes("에세이") ? 7 : 4,
    technicalVocabulary: input.knowledgeLevel === "beginner" ? 3 : 7,
    dialogueRatio: input.bookType.includes("소설") ? 35 : 5,
    narrativeSpeed: 6
  });
}

function temporaryTitle(idea: string) {
  const compact = idea.replace(/\s+/g, " ").trim();
  return compact.length > 64 ? `${compact.slice(0, 61)}…` : compact;
}

function safeName(title: string) {
  return title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "book";
}

async function saveOpenRouterKeyFromRequest(request: Request, userId: string) {
  const requestKey = request.headers.get("x-openrouter-key")?.trim();
  if (!requestKey || requestKey.length < 16) return;
  const service = createServiceSupabase();
  const { error } = await service.rpc("store_openrouter_credential", { p_user_id: userId, p_secret: requestKey });
  if (error) throw new Error(error.message);
}

async function assertCodexReady(userId: string) {
  const service = createServiceSupabase();
  const { data: profile, error } = await service.from("codex_connection_profiles")
    .select("model_available")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (profile?.model_available === false) throw new Error("CODEX_LUNA_UNAVAILABLE");
}

async function handleRegister(request: Request) {
  try {
    const body = await request.json() as { email?: string; password?: string };
    const email = body.email?.trim().toLowerCase() ?? "";
    const password = body.password ?? "";
    if (!/^\S+@\S+\.\S+$/.test(email)) return bad("올바른 이메일을 입력해 주세요.");
    if (password.length < 8 || password.length > 128) return bad("비밀번호는 8~128자로 입력해 주세요.");
    const result = await registerViaServiceBridge(email, password);
    if (result.error) return bad(result.error.message);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return bad(error instanceof Error ? error.message : "회원가입에 실패했습니다.", 500);
  }
}

async function handleOpenRouterExchange(request: Request) {
  try {
    const { user } = await requireUser();
    const { code, verifier } = OpenRouterExchangeSchema.parse(await request.json());
    const response = await fetch("https://openrouter.ai/api/v1/auth/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" })
    });
    const payload = await response.json() as OpenRouterExchange;
    if (!response.ok || !payload.key) {
      return bad(payload.error?.message ?? "무료 AI 연결에 실패했습니다.", response.status || 400);
    }
    const service = createServiceSupabase();
    const { error } = await service.rpc("store_openrouter_credential", { p_user_id: user.id, p_secret: payload.key });
    if (error) throw new Error(`FREE_AI_VAULT_SAVE_FAILED: ${error.message}`);
    return NextResponse.json({ key: payload.key, backgroundReady: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "무료 AI 연결에 실패했습니다.";
    return bad(message, message === "UNAUTHORIZED" ? 401 : 400);
  }
}

async function handleHealth() {
  try {
    const bridge = await serviceBridgeHealth();
    const supabase = createServiceSupabase();
    const { data: plans, error } = await supabase.from("plans").select("code").limit(1);
    if (error) throw new Error(`Bridge database check failed: ${error.message}`);
    const ok = bridge?.ok === true && Array.isArray(plans);
    return NextResponse.json(
      { ok, service: bridge?.service ?? "unknown", database: ok ? "reachable" : "unavailable" },
      { status: ok ? 200 : 503 }
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Service bridge unavailable" }, { status: 503 });
  }
}

async function handleCreateBook(request: Request) {
  let createdBookId: string | null = null;
  try {
    const { supabase, user } = await requireUser();
    const input = CreateBookSchema.parse(await request.json());
    await assertRateLimit(user.id, "book-create", 8, 3600);

    const targetWords = computeWordBudget(input.targetPages, input.bookType);
    const planningInput = { ...input, targetWords };
    const reader = inferReaderProfile(input);
    const style = inferWritingStyle(input);
    const rule = getBookTypeRule(input.bookType);

    if (input.aiProvider === "openrouter") await saveOpenRouterKeyFromRequest(request, user.id);
    if (!(await hasBackgroundCredential(user.id, input.aiProvider))) {
      return NextResponse.json({
        error: input.aiProvider === "codex" ? "CODEX_CONNECTION_REQUIRED" : "FREE_AI_CONNECTION_REQUIRED",
        reconnect: true,
        provider: input.aiProvider
      }, { status: 428 });
    }
    if (input.aiProvider === "codex") {
      try { await assertCodexReady(user.id); }
      catch (error) {
        if (error instanceof Error && error.message === "CODEX_LUNA_UNAVAILABLE") return bad(error.message, 409);
        throw error;
      }
    }

    const { data: book, error: bookError } = await supabase.from("books").insert({
      user_id: user.id,
      title: temporaryTitle(input.idea),
      subtitle: "Book Blueprint 생성 중",
      idea: input.idea,
      book_type: input.bookType,
      book_family: rule.family,
      status: "PLANNING",
      target_pages: input.targetPages,
      target_words: targetWords,
      progress: 0,
      quality_scores: {}
    }).select("id").single();
    if (bookError || !book) throw bookError ?? new Error("BOOK_CREATE_FAILED");
    createdBookId = book.id;

    const setupResults = await Promise.all([
      supabase.from("reader_profiles").insert({
        book_id: book.id,
        age_group: reader.ageGroup,
        knowledge_level: reader.knowledgeLevel,
        reading_purpose: reader.readingPurpose,
        preferred_complexity: reader.preferredComplexity,
        tone_preference: reader.tonePreference,
        technical_tolerance: reader.technicalTolerance,
        example_preference: reader.examplePreference,
        reading_speed: reader.readingSpeed
      }),
      supabase.from("writing_styles").insert({
        book_id: book.id,
        label: style.label,
        description: style.description,
        sentence_length: style.sentenceLength,
        description_depth: style.descriptionDepth,
        emotion_level: style.emotionLevel,
        technical_vocabulary: style.technicalVocabulary,
        dialogue_ratio: style.dialogueRatio,
        narrative_speed: style.narrativeSpeed
      }),
      supabase.from("book_settings").insert({
        book_id: book.id,
        target_pages: input.targetPages,
        target_words: targetWords,
        template_id: input.templateMood.toLowerCase().replace(/\s+/g, "-"),
        chapter_count: null,
        creativity: 6,
        research_depth: 2,
        writing_density: 6,
        sentence_length: style.sentenceLength,
        vocabulary_level: style.technicalVocabulary,
        examples_frequency: 6,
        citation_level: "none",
        image_frequency: 3,
        narrative_level: style.narrativeSpeed,
        technical_depth: style.technicalVocabulary,
        planning_input: planningInput
      })
    ]);
    const setupError = setupResults.find((result) => result.error)?.error;
    if (setupError) throw setupError;

    const { data: job, error: jobError } = await supabase.from("generation_jobs").insert({
      book_id: book.id,
      user_id: user.id,
      status: "QUEUED",
      progress: 5,
      started_at: new Date().toISOString()
    }).select("id").single();
    if (jobError || !job) throw jobError ?? new Error("PLANNING_JOB_CREATE_FAILED");

    const run = await start(generateFreeBlueprintWorkflow, [{ bookId: book.id, userId: user.id, jobId: job.id, form: planningInput }]);
    const providerLabel = backgroundProviderLabel(input.aiProvider);
    await Promise.all([
      supabase.from("generation_jobs").update({ workflow_run_id: run.runId, status: "PLANNING", progress: 8 }).eq("id", job.id),
      supabase.from("job_logs").insert({ generation_job_id: job.id, level: "info", message: `${providerLabel} Book Blueprint가 백그라운드 작업으로 등록되었습니다. 화면을 나가도 계속 진행됩니다.` })
    ]);

    return NextResponse.json({
      bookId: book.id,
      jobId: job.id,
      runId: run.runId,
      background: true,
      planning: true,
      aiMode: input.aiProvider,
      model: input.aiProvider === "codex" ? "gpt-5.6-luna" : "openrouter/free"
    }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (createdBookId) {
      try {
        const { supabase } = await requireUser();
        await supabase.from("books").update({ status: "FAILED" }).eq("id", createdBookId);
      } catch { /* best effort */ }
    }
    return NextResponse.json({ error: message, bookId: createdBookId }, { status: message === "UNAUTHORIZED" ? 401 : message === "RATE_LIMITED" ? 429 : 400 });
  }
}

async function handlePlanResume(request: Request, bookId: string) {
  try {
    const { supabase, user } = await requireUser();
    await assertRateLimit(user.id, "book-plan-resume", 12, 3600);
    const { data: book, error } = await supabase.from("books")
      .select("id,user_id,status,book_settings(planning_input)")
      .eq("id", bookId)
      .single();
    if (error || !book || book.user_id !== user.id) return bad("Book not found.", 404);

    const relation = book.book_settings as unknown as { planning_input?: unknown } | Array<{ planning_input?: unknown }> | null;
    const settings = Array.isArray(relation) ? relation[0] : relation;
    const planningInput = PlanningInputSchema.parse(settings?.planning_input);
    const provider = normalizeBackgroundProvider(planningInput.aiProvider);

    if (provider === "openrouter") await saveOpenRouterKeyFromRequest(request, user.id);
    if (!(await hasBackgroundCredential(user.id, provider))) {
      return NextResponse.json({ error: provider === "codex" ? "CODEX_CONNECTION_REQUIRED" : "FREE_AI_CONNECTION_REQUIRED", reconnect: true, provider }, { status: 428 });
    }
    if (provider === "codex") {
      try { await assertCodexReady(user.id); }
      catch (caught) {
        if (caught instanceof Error && caught.message === "CODEX_LUNA_UNAVAILABLE") return bad(caught.message, 409);
        throw caught;
      }
    }

    const { data: activeJobs } = await supabase.from("generation_jobs")
      .select("id,status,progress,workflow_run_id,created_at")
      .eq("book_id", bookId)
      .in("status", activePlanningStatuses)
      .order("created_at", { ascending: false })
      .limit(1);
    const active = activeJobs?.[0];
    if (active?.workflow_run_id) return NextResponse.json({ jobId: active.id, runId: active.workflow_run_id, background: true, alreadyRunning: true, provider });

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
    return bad(message, message === "UNAUTHORIZED" ? 401 : message === "RATE_LIMITED" ? 429 : 400);
  }
}

async function handleGenerate(request: Request, bookId: string) {
  if (bookId === "codex" && request.headers.get("authorization")?.startsWith("Bearer ")) {
    const { handleCodexGenerationBridge } = await import("@/lib/ai/codex-internal");
    return handleCodexGenerationBridge(request);
  }

  try {
    const { supabase, user } = await requireUser();
    await assertRateLimit(user.id, "book-generate", 12, 3600);
    const { data: book, error } = await supabase.from("books")
      .select("id,user_id,status,progress,book_settings(planning_input)")
      .eq("id", bookId)
      .single();
    if (error || !book || book.user_id !== user.id) return bad("Book not found.", 404);
    if (book.status === "COMPLETED") return NextResponse.json({ done: true, progress: 100 });

    const relation = book.book_settings as unknown as SettingsRelation;
    const settings = Array.isArray(relation) ? relation[0] : relation;
    const provider = normalizeBackgroundProvider(settings?.planning_input?.aiProvider);
    if (provider === "openrouter") await saveOpenRouterKeyFromRequest(request, user.id);
    if (!(await hasBackgroundCredential(user.id, provider))) {
      return NextResponse.json({ error: provider === "codex" ? "CODEX_CONNECTION_REQUIRED" : "FREE_AI_CONNECTION_REQUIRED", reconnect: true, provider }, { status: 428 });
    }
    if (provider === "codex") {
      try { await assertCodexReady(user.id); }
      catch (caught) {
        if (caught instanceof Error && caught.message === "CODEX_LUNA_UNAVAILABLE") return bad(caught.message, 409);
        throw caught;
      }
    }

    const { data: activeJobs } = await supabase.from("generation_jobs")
      .select("id,status,progress,workflow_run_id,created_at")
      .eq("book_id", bookId)
      .in("status", activeGenerationStatuses)
      .order("created_at", { ascending: false })
      .limit(1);
    const activeJob = activeJobs?.[0];
    if (activeJob?.workflow_run_id) {
      if (book.status === "PAUSED") await supabase.from("books").update({ status: "GENERATING" }).eq("id", bookId);
      return NextResponse.json({ jobId: activeJob.id, runId: activeJob.workflow_run_id, progress: Number(activeJob.progress ?? book.progress ?? 0), background: true, alreadyRunning: true, provider });
    }

    const { data: job, error: jobError } = await supabase.from("generation_jobs").insert({
      book_id: bookId,
      user_id: user.id,
      status: "QUEUED",
      progress: Number(book.progress ?? 0),
      started_at: new Date().toISOString()
    }).select("id").single();
    if (jobError || !job) throw jobError ?? new Error("GENERATION_JOB_CREATE_FAILED");

    const run = await start(generateFreeBookWorkflow, [{ bookId, userId: user.id, jobId: job.id, provider }]);
    const providerLabel = backgroundProviderLabel(provider);
    await Promise.all([
      supabase.from("generation_jobs").update({ workflow_run_id: run.runId, status: "GENERATING" }).eq("id", job.id),
      supabase.from("books").update({ status: "GENERATING" }).eq("id", bookId),
      supabase.from("job_logs").insert({ generation_job_id: job.id, level: "info", message: `${providerLabel} 백그라운드 생성 작업이 등록되었습니다. 화면을 나가도 계속 진행됩니다.` })
    ]);
    return NextResponse.json({ jobId: job.id, runId: run.runId, background: true, alreadyRunning: false, provider });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed.";
    return bad(message, message === "UNAUTHORIZED" ? 401 : message === "RATE_LIMITED" ? 429 : 400);
  }
}

async function handleExport(bookId: string, format: string) {
  try {
    if (!(format in exportFormats)) return bad("Unsupported format");
    const { supabase, user } = await requireUser();
    await assertRateLimit(user.id, "book-export", 20, 3600);
    const { data: owned } = await supabase.from("books").select("id,title").eq("id", bookId).single();
    if (!owned) return bad("Book not found", 404);

    const exportFormat = format as ExportFormat;
    const { data: job } = await supabase.from("export_jobs").insert({
      book_id: bookId,
      user_id: user.id,
      format: exportFormat.toUpperCase(),
      status: "RUNNING"
    }).select("id").single();

    try {
      const book = await collectBook(bookId);
      let body: Uint8Array;
      if (exportFormat === "pdf") body = new Uint8Array(await renderBookPdf(book));
      else if (exportFormat === "epub") body = new Uint8Array(await renderBookEpub(book));
      else if (exportFormat === "docx") body = new Uint8Array(await renderBookDocx(book));
      else {
        const markdown = bookToMarkdown(book);
        const text = exportFormat === "txt" ? stripMarkdown(markdown) : markdown;
        body = new TextEncoder().encode(text);
      }
      if (job) await supabase.from("export_jobs").update({ status: "COMPLETED", finished_at: new Date().toISOString() }).eq("id", job.id);
      const meta = exportFormats[exportFormat];
      return new Response(body as unknown as BodyInit, {
        headers: {
          "content-type": meta.type,
          "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeName(book.title))}.${meta.ext}`,
          "cache-control": "private, no-store"
        }
      });
    } catch (error) {
      if (job) await supabase.from("export_jobs").update({ status: "FAILED", error_message: error instanceof Error ? error.message : String(error), finished_at: new Date().toISOString() }).eq("id", job.id);
      throw error;
    }
  } catch (error) {
    return bad(error instanceof Error ? error.message : "Export failed");
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = await pathOf(params);
  if (path[0] === "editor") return handleEditorGET(request, path.slice(1));
  if (path[0] === "auth" && path[1] === "ai-connection") return handleAiConnectionGET(request);
  if (path[0] === "health" && path[1] === "service-bridge") return handleHealth();
  if (path[0] === "books" && path[2] === "export" && path[3]) return handleExport(path[1], path[3]);
  return bad("Unknown core route", 404);
}

export async function POST(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = await pathOf(params);
  if (path[0] === "editor") return handleEditorPOST(request, path.slice(1));
  if (path[0] === "auth" && path[1] === "ai-connection") return handleAiConnectionPOST(request);
  if (path[0] === "auth" && path[1] === "register") return handleRegister(request);
  if (path[0] === "auth" && path[1] === "openrouter-exchange") return handleOpenRouterExchange(request);
  if (path.length === 1 && path[0] === "books") return handleCreateBook(request);
  if (path[0] === "books" && path[2] === "plan") return handlePlanResume(request, path[1]);
  if (path[0] === "books" && path[2] === "generate") return handleGenerate(request, path[1]);
  return bad("Unknown core route", 404);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = await pathOf(params);
  if (path[0] === "editor") return handleEditorPATCH(request, path.slice(1));
  return bad("Unknown core route", 404);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const path = await pathOf(params);
  if (path[0] === "editor") return handleEditorDELETE(request, path.slice(1));
  if (path[0] === "auth" && path[1] === "ai-connection") return handleAiConnectionDELETE(request);
  return bad("Unknown core route", 404);
}
