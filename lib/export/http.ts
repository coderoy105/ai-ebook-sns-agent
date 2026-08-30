import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { requireUser } from "@/lib/supabase/server";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { generateBookExportWorkflow } from "@/lib/jobs/export-workflow";
import { readExportArtifact } from "./artifact-store";
import { decodeExportProgress, encodeExportProgress } from "./progress";

const exportFormats = {
  pdf: { type: "application/pdf", ext: "pdf" },
  epub: { type: "application/epub+zip", ext: "epub" },
  docx: { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" },
  md: { type: "text/markdown; charset=utf-8", ext: "md" },
  txt: { type: "text/plain; charset=utf-8", ext: "txt" }
} as const;

type ExportFormat = keyof typeof exportFormats;

type ServiceSupabase = Awaited<ReturnType<typeof requireUser>>["supabase"];

function bad(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
}

function safeName(title: string) {
  return title
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || "book";
}

function contentDisposition(title: string, ext: string) {
  const base = safeName(title);
  const unicodeName = `${base}.${ext}`;
  const asciiBase = base
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\;]/g, "_")
    .replace(/_+/g, "_")
    .trim()
    .slice(0, 72) || "book";
  return `attachment; filename="${asciiBase}.${ext}"; filename*=UTF-8''${encodeURIComponent(unicodeName)}`;
}

async function ownedBook(bookId: string, userId: string, supabase: ServiceSupabase) {
  const { data, error } = await supabase
    .from("books")
    .select("id,title,user_id,updated_at")
    .eq("id", bookId)
    .eq("user_id", userId)
    .single();
  if (error || !data) return null;
  return data;
}

async function latestExportJob(
  supabase: ServiceSupabase,
  input: { bookId: string; userId: string; format: ExportFormat; jobId?: string | null }
) {
  let query = supabase.from("export_jobs")
    .select("id,book_id,user_id,format,status,asset_id,error_message,created_at,finished_at")
    .eq("book_id", input.bookId)
    .eq("user_id", input.userId)
    .eq("format", input.format.toUpperCase());

  if (input.jobId) {
    return query.eq("id", input.jobId).maybeSingle();
  }
  return query.order("created_at", { ascending: false }).limit(1).maybeSingle();
}

function completedExportIsFresh(bookUpdatedAt: unknown, finishedAt: unknown) {
  const bookTime = Date.parse(String(bookUpdatedAt ?? ""));
  const exportTime = Date.parse(String(finishedAt ?? ""));
  if (!Number.isFinite(bookTime) || !Number.isFinite(exportTime)) return false;
  return exportTime >= bookTime;
}

export async function startBookExport(bookId: string, rawFormat: string) {
  try {
    if (!(rawFormat in exportFormats)) return bad("Unsupported format");
    const format = rawFormat as ExportFormat;
    const { supabase, user } = await requireUser();
    const book = await ownedBook(bookId, user.id, supabase);
    if (!book) return bad("Book not found", 404);

    const { data: existing } = await latestExportJob(supabase, { bookId, userId: user.id, format });
    if (existing && (existing.status === "QUEUED" || existing.status === "RUNNING")) {
      return NextResponse.json({
        jobId: existing.id,
        status: existing.status,
        background: true,
        reused: true
      }, { status: 202, headers: { "cache-control": "no-store" } });
    }
    if (
      existing &&
      existing.status === "COMPLETED" &&
      existing.asset_id &&
      completedExportIsFresh(book.updated_at, existing.finished_at)
    ) {
      return NextResponse.json({
        jobId: existing.id,
        status: "COMPLETED",
        background: true,
        reused: true,
        ready: true
      }, { status: 200, headers: { "cache-control": "no-store" } });
    }

    await assertRateLimit(user.id, "book-export", 20, 3600);
    const { data: job, error: jobError } = await supabase.from("export_jobs").insert({
      book_id: bookId,
      user_id: user.id,
      format: format.toUpperCase(),
      status: "QUEUED",
      error_message: encodeExportProgress({
        progress: 1,
        phase: "queued",
        message: "백그라운드 파일 생성을 등록하고 있습니다."
      })
    }).select("id").single();
    if (jobError || !job) throw jobError ?? new Error("EXPORT_JOB_CREATE_FAILED");

    try {
      const run = await start(generateBookExportWorkflow, [{
        bookId,
        userId: user.id,
        jobId: String(job.id),
        format
      }]);
      const { error: updateError } = await supabase.from("export_jobs").update({
        status: "RUNNING",
        error_message: encodeExportProgress({
          progress: 2,
          phase: "queued",
          message: "백그라운드 작업이 시작되었습니다. 앱을 닫아도 계속 진행됩니다."
        })
      }).eq("id", job.id);
      if (updateError) throw new Error(updateError.message);

      return NextResponse.json({
        jobId: job.id,
        runId: run.runId,
        status: "RUNNING",
        background: true
      }, { status: 202, headers: { "cache-control": "no-store" } });
    } catch (error) {
      await supabase.from("export_jobs").update({
        status: "FAILED",
        error_message: error instanceof Error ? error.message : String(error),
        finished_at: new Date().toISOString()
      }).eq("id", job.id);
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export start failed";
    return bad(message, message === "UNAUTHORIZED" ? 401 : message === "RATE_LIMITED" ? 429 : 400);
  }
}

export async function getBookExportStatus(bookId: string, rawFormat: string, jobId: string | null) {
  try {
    if (!(rawFormat in exportFormats)) return bad("Unsupported format");
    const format = rawFormat as ExportFormat;
    const { supabase, user } = await requireUser();
    const book = await ownedBook(bookId, user.id, supabase);
    if (!book) return bad("Book not found", 404);

    const { data: job, error } = await latestExportJob(supabase, {
      bookId,
      userId: user.id,
      format,
      jobId
    });
    if (error || !job) return bad("Export job not found", 404);

    if (job.status === "FAILED") {
      return NextResponse.json({
        jobId: job.id,
        status: "FAILED",
        progress: 0,
        phase: "error",
        background: true,
        message: job.error_message || "파일 생성에 실패했습니다."
      }, { headers: { "cache-control": "no-store" } });
    }

    if (job.status === "COMPLETED" && job.asset_id) {
      return NextResponse.json({
        jobId: job.id,
        status: "COMPLETED",
        progress: 90,
        phase: "ready",
        background: true,
        ready: true,
        message: "백그라운드 파일 생성이 완료되었습니다. 다운로드를 시작합니다."
      }, { headers: { "cache-control": "no-store" } });
    }

    const progress = decodeExportProgress(job.error_message) ?? {
      progress: job.status === "QUEUED" ? 1 : 2,
      phase: "queued" as const,
      message: "백그라운드에서 파일을 만들고 있습니다. 앱을 닫아도 계속 진행됩니다."
    };
    return NextResponse.json({
      jobId: job.id,
      status: job.status,
      background: true,
      ready: false,
      ...progress
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export status failed";
    return bad(message, message === "UNAUTHORIZED" ? 401 : 400);
  }
}

export async function handleBookExport(bookId: string, rawFormat: string, jobId?: string | null) {
  try {
    if (!(rawFormat in exportFormats)) return bad("Unsupported format");
    const format = rawFormat as ExportFormat;
    const { supabase, user } = await requireUser();
    const book = await ownedBook(bookId, user.id, supabase);
    if (!book) return bad("Book not found", 404);

    const { data: job, error: jobError } = await latestExportJob(supabase, {
      bookId,
      userId: user.id,
      format,
      jobId
    });
    if (jobError || !job) return bad("Export job not found", 404);
    if (job.status !== "COMPLETED" || !job.asset_id) {
      return NextResponse.json({
        error: "EXPORT_NOT_READY",
        jobId: job.id,
        status: job.status,
        background: true
      }, { status: 409, headers: { "cache-control": "no-store" } });
    }

    const { data: asset, error: assetError } = await supabase.from("assets")
      .select("id,book_id,user_id,storage_path,mime_type,metadata")
      .eq("id", job.asset_id)
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .single();
    if (assetError || !asset) return bad("Export artifact not found", 404);

    const body = await readExportArtifact(String(asset.storage_path));
    if (format === "pdf" && body.subarray(0, 4).toString("ascii") !== "%PDF") {
      throw new Error("PDF_RENDER_INVALID");
    }

    const meta = exportFormats[format];
    return new Response(body as unknown as BodyInit, {
      status: 200,
      headers: {
        "content-type": typeof asset.mime_type === "string" && asset.mime_type ? asset.mime_type : meta.type,
        "content-length": String(body.byteLength),
        "content-disposition": contentDisposition(String(book.title), meta.ext),
        "cache-control": "private, no-store, max-age=0",
        "x-content-type-options": "nosniff",
        "x-export-job-id": String(job.id),
        "x-export-background": "1"
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    return bad(message, message === "UNAUTHORIZED" ? 401 : 400);
  }
}
