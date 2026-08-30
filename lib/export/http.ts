import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { assertRateLimit } from "@/lib/security/rate-limit";
import { collectBook, bookToMarkdown, stripMarkdown } from "./collect";
import { renderBookPdf } from "./pdf";
import { renderBookEpub } from "./epub";
import { renderBookDocx } from "./docx";

const exportFormats = {
  pdf: { type: "application/pdf", ext: "pdf" },
  epub: { type: "application/epub+zip", ext: "epub" },
  docx: { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" },
  md: { type: "text/markdown; charset=utf-8", ext: "md" },
  txt: { type: "text/plain; charset=utf-8", ext: "txt" }
} as const;

type ExportFormat = keyof typeof exportFormats;
type ProgressPhase = "queued" | "collecting" | "rendering" | "merging" | "ready";
type ProgressPayload = { progress: number; phase: ProgressPhase; message: string };

const progressPrefix = "__EXPORT_PROGRESS__";

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

function encodeProgress(payload: ProgressPayload) {
  return `${progressPrefix}${JSON.stringify(payload)}`;
}

function decodeProgress(value: string | null | undefined): ProgressPayload | null {
  if (!value?.startsWith(progressPrefix)) return null;
  try {
    const parsed = JSON.parse(value.slice(progressPrefix.length)) as Partial<ProgressPayload>;
    if (typeof parsed.progress !== "number" || typeof parsed.message !== "string" || typeof parsed.phase !== "string") return null;
    return {
      progress: Math.max(0, Math.min(90, parsed.progress)),
      phase: parsed.phase as ProgressPhase,
      message: parsed.message
    };
  } catch {
    return null;
  }
}

async function ownedBook(bookId: string, userId: string, supabase: Awaited<ReturnType<typeof requireUser>>["supabase"]) {
  const { data, error } = await supabase
    .from("books")
    .select("id,title,user_id")
    .eq("id", bookId)
    .eq("user_id", userId)
    .single();
  if (error || !data) return null;
  return data;
}

async function updateProgress(
  supabase: Awaited<ReturnType<typeof requireUser>>["supabase"],
  jobId: string,
  progress: number,
  phase: ProgressPhase,
  message: string
) {
  await supabase.from("export_jobs").update({
    status: "RUNNING",
    error_message: encodeProgress({ progress: Math.max(0, Math.min(90, progress)), phase, message })
  }).eq("id", jobId);
}

export async function startBookExport(bookId: string, rawFormat: string) {
  try {
    if (!(rawFormat in exportFormats)) return bad("Unsupported format");
    const exportFormat = rawFormat as ExportFormat;
    const { supabase, user } = await requireUser();
    await assertRateLimit(user.id, "book-export", 20, 3600);
    const book = await ownedBook(bookId, user.id, supabase);
    if (!book) return bad("Book not found", 404);

    const { data: job, error } = await supabase.from("export_jobs").insert({
      book_id: bookId,
      user_id: user.id,
      format: exportFormat.toUpperCase(),
      status: "RUNNING",
      error_message: encodeProgress({ progress: 1, phase: "queued", message: `${exportFormat.toUpperCase()} 생성을 준비하고 있습니다.` })
    }).select("id").single();
    if (error || !job) throw error ?? new Error("EXPORT_JOB_CREATE_FAILED");
    return NextResponse.json({ jobId: job.id }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export start failed";
    return bad(message, message === "UNAUTHORIZED" ? 401 : message === "RATE_LIMITED" ? 429 : 400);
  }
}

export async function getBookExportStatus(bookId: string, rawFormat: string, jobId: string | null) {
  try {
    if (!(rawFormat in exportFormats)) return bad("Unsupported format");
    if (!jobId) return bad("EXPORT_JOB_ID_REQUIRED");
    const exportFormat = rawFormat as ExportFormat;
    const { supabase, user } = await requireUser();
    const book = await ownedBook(bookId, user.id, supabase);
    if (!book) return bad("Book not found", 404);

    const { data: job, error } = await supabase.from("export_jobs")
      .select("id,status,error_message,finished_at")
      .eq("id", jobId)
      .eq("book_id", bookId)
      .eq("user_id", user.id)
      .eq("format", exportFormat.toUpperCase())
      .single();
    if (error || !job) return bad("Export job not found", 404);

    if (job.status === "FAILED") {
      return NextResponse.json({
        status: "FAILED",
        progress: 0,
        phase: "error",
        message: job.error_message || "파일 생성에 실패했습니다."
      }, { headers: { "cache-control": "no-store" } });
    }
    if (job.status === "COMPLETED") {
      return NextResponse.json({
        status: "COMPLETED",
        progress: 90,
        phase: "ready",
        message: "파일 생성이 완료되어 다운로드를 시작합니다."
      }, { headers: { "cache-control": "no-store" } });
    }

    const progress = decodeProgress(job.error_message) ?? {
      progress: 1,
      phase: "queued" as const,
      message: "파일 생성을 준비하고 있습니다."
    };
    return NextResponse.json({ status: job.status, ...progress }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export status failed";
    return bad(message, message === "UNAUTHORIZED" ? 401 : 400);
  }
}

export async function handleBookExport(bookId: string, rawFormat: string, jobId?: string | null) {
  try {
    if (!(rawFormat in exportFormats)) return bad("Unsupported format");
    const exportFormat = rawFormat as ExportFormat;
    const { supabase, user } = await requireUser();
    const bookOwner = await ownedBook(bookId, user.id, supabase);
    if (!bookOwner) return bad("Book not found", 404);

    let activeJobId = jobId ?? null;
    if (activeJobId) {
      const { data: existing } = await supabase.from("export_jobs")
        .select("id,status")
        .eq("id", activeJobId)
        .eq("book_id", bookId)
        .eq("user_id", user.id)
        .eq("format", exportFormat.toUpperCase())
        .single();
      if (!existing || existing.status !== "RUNNING") return bad("Export job not found", 404);
    } else {
      await assertRateLimit(user.id, "book-export", 20, 3600);
      const { data: job, error } = await supabase.from("export_jobs").insert({
        book_id: bookId,
        user_id: user.id,
        format: exportFormat.toUpperCase(),
        status: "RUNNING",
        error_message: encodeProgress({ progress: 1, phase: "queued", message: `${exportFormat.toUpperCase()} 생성을 준비하고 있습니다.` })
      }).select("id").single();
      if (error || !job) throw error ?? new Error("EXPORT_JOB_CREATE_FAILED");
      activeJobId = job.id;
    }

    try {
      await updateProgress(supabase, activeJobId, 3, "collecting", "원고와 목차를 불러오고 있습니다.");
      const book = await collectBook(bookId);
      let body: Uint8Array;

      if (exportFormat === "pdf") {
        body = new Uint8Array(await renderBookPdf(book, async (progress, message) => {
          const phase: ProgressPhase = progress >= 90 ? "merging" : "rendering";
          await updateProgress(supabase, activeJobId!, progress, phase, message);
        }));
      } else if (exportFormat === "epub") {
        await updateProgress(supabase, activeJobId, 35, "rendering", "EPUB 파일을 만들고 있습니다.");
        body = new Uint8Array(await renderBookEpub(book));
      } else if (exportFormat === "docx") {
        await updateProgress(supabase, activeJobId, 35, "rendering", "DOCX 파일을 만들고 있습니다.");
        body = new Uint8Array(await renderBookDocx(book));
      } else {
        await updateProgress(supabase, activeJobId, 55, "rendering", "텍스트 파일을 만들고 있습니다.");
        const markdown = bookToMarkdown(book);
        const text = exportFormat === "txt" ? stripMarkdown(markdown) : markdown;
        body = new TextEncoder().encode(text);
      }

      if (body.byteLength === 0) throw new Error("EXPORT_EMPTY_FILE");

      await supabase.from("export_jobs").update({
        status: "COMPLETED",
        error_message: null,
        finished_at: new Date().toISOString()
      }).eq("id", activeJobId);

      const meta = exportFormats[exportFormat];
      return new Response(body as unknown as BodyInit, {
        status: 200,
        headers: {
          "content-type": meta.type,
          "content-length": String(body.byteLength),
          "content-disposition": contentDisposition(book.title, meta.ext),
          "cache-control": "private, no-store, max-age=0",
          "x-content-type-options": "nosniff",
          "x-export-job-id": activeJobId
        }
      });
    } catch (error) {
      await supabase.from("export_jobs").update({
        status: "FAILED",
        error_message: error instanceof Error ? error.message : String(error),
        finished_at: new Date().toISOString()
      }).eq("id", activeJobId);
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    return bad(message, message === "UNAUTHORIZED" ? 401 : message === "RATE_LIMITED" ? 429 : 400);
  }
}
