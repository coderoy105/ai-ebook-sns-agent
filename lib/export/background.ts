import { createServiceSupabase } from "@/lib/supabase/server";
import { collectBook, bookToMarkdown, stripMarkdown } from "./collect";
import {
  mergeBookPdfChunks,
  pdfChapterCount,
  renderBookPdfChapterChunk,
  renderBookPdfFrontChunk
} from "./pdf";
import { renderBookEpub } from "./epub";
import { renderBookDocx } from "./docx";
import {
  readExportChunk,
  writeExportArtifact,
  writeExportChunk
} from "./artifact-store";
import { encodeExportProgress, type ExportProgressPhase } from "./progress";

export const backgroundExportFormats = {
  pdf: { type: "application/pdf", ext: "pdf" },
  epub: { type: "application/epub+zip", ext: "epub" },
  docx: { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ext: "docx" },
  md: { type: "text/markdown; charset=utf-8", ext: "md" },
  txt: { type: "text/plain; charset=utf-8", ext: "txt" }
} as const;

export type BackgroundExportFormat = keyof typeof backgroundExportFormats;
export type BackgroundExportInput = {
  bookId: string;
  userId: string;
  jobId: string;
  format: BackgroundExportFormat;
};

type ExportJobRow = {
  id: string;
  book_id: string;
  user_id: string;
  format: string;
  status: string;
  asset_id: string | null;
};

async function updateProgress(jobId: string, progress: number, phase: ExportProgressPhase, message: string) {
  const supabase = createServiceSupabase();
  const { error } = await supabase.from("export_jobs").update({
    status: "RUNNING",
    error_message: encodeExportProgress({ progress, phase, message })
  }).eq("id", jobId);
  if (error) throw new Error(`EXPORT_PROGRESS_SAVE_FAILED:${error.message}`);
}

async function loadJob(input: BackgroundExportInput) {
  const supabase = createServiceSupabase();
  const { data: job, error } = await supabase.from("export_jobs")
    .select("id,book_id,user_id,format,status,asset_id")
    .eq("id", input.jobId)
    .eq("book_id", input.bookId)
    .eq("user_id", input.userId)
    .single();
  if (error || !job) throw new Error(error?.message ?? "EXPORT_JOB_NOT_FOUND");
  if (String(job.format).toLowerCase() !== input.format) throw new Error("EXPORT_FORMAT_MISMATCH");
  return job as unknown as ExportJobRow;
}

async function markFailed(jobId: string, error: unknown) {
  const supabase = createServiceSupabase();
  const message = error instanceof Error ? error.message : String(error);
  await supabase.from("export_jobs").update({
    status: "FAILED",
    error_message: message.slice(0, 4000),
    finished_at: new Date().toISOString()
  }).eq("id", jobId);
}

export async function markBackgroundExportFailed(input: BackgroundExportInput, message: string) {
  await markFailed(input.jobId, message);
}

async function persistCompletedExport(input: BackgroundExportInput, body: Uint8Array, title: string) {
  if (!body.byteLength) throw new Error("EXPORT_EMPTY_FILE");
  const supabase = createServiceSupabase();
  const meta = backgroundExportFormats[input.format];

  await updateProgress(input.jobId, 88, "storing", "완성된 파일을 안전하게 보관하고 있습니다.");
  const stored = await writeExportArtifact({
    userId: input.userId,
    jobId: input.jobId,
    extension: meta.ext,
    bytes: body
  });

  let assetId: string | null = null;
  const { data: existingAsset } = await supabase.from("assets")
    .select("id")
    .eq("book_id", input.bookId)
    .eq("user_id", input.userId)
    .eq("storage_path", stored.path)
    .maybeSingle();
  if (existingAsset?.id) {
    assetId = String(existingAsset.id);
  } else {
    const { data: asset, error: assetError } = await supabase.from("assets").insert({
      book_id: input.bookId,
      user_id: input.userId,
      asset_type: `export-${input.format}`,
      storage_path: stored.path,
      mime_type: meta.type,
      metadata: {
        backend: stored.backend,
        sandboxName: stored.sandboxName,
        byteLength: stored.byteLength,
        format: input.format,
        title
      }
    }).select("id").single();
    if (assetError || !asset) throw new Error(assetError?.message ?? "EXPORT_ASSET_CREATE_FAILED");
    assetId = String(asset.id);
  }

  const { error: finishError } = await supabase.from("export_jobs").update({
    status: "COMPLETED",
    asset_id: assetId,
    error_message: encodeExportProgress({
      progress: 90,
      phase: "ready",
      message: "백그라운드 파일 생성이 완료되었습니다. 다운로드할 준비가 됐습니다."
    }),
    finished_at: new Date().toISOString()
  }).eq("id", input.jobId);
  if (finishError) throw new Error(`EXPORT_FINISH_SAVE_FAILED:${finishError.message}`);

  return { status: "completed" as const, assetId, byteLength: body.byteLength };
}

export async function prepareBackgroundPdfExport(input: BackgroundExportInput) {
  if (input.format !== "pdf") throw new Error("EXPORT_FORMAT_MISMATCH");
  const job = await loadJob(input);
  if (job.status === "COMPLETED" && job.asset_id) {
    return { status: "completed" as const, assetId: String(job.asset_id), chapterCount: 0 };
  }

  await updateProgress(input.jobId, 3, "collecting", "원고와 목차를 불러오고 있습니다. 이 화면을 닫아도 계속 진행됩니다.");
  const book = await collectBook(input.bookId);
  const chapterCount = pdfChapterCount(book);
  await updateProgress(input.jobId, 5, "rendering", `PDF를 ${chapterCount + 1}개 조각으로 나눠 백그라운드에서 생성합니다.`);
  return { status: "ready" as const, chapterCount };
}

export async function renderBackgroundPdfFront(input: BackgroundExportInput) {
  const job = await loadJob(input);
  if (job.status === "COMPLETED" && job.asset_id) return { status: "completed" as const };
  const book = await collectBook(input.bookId);
  await updateProgress(input.jobId, 6, "rendering", "표지와 목차 PDF를 만들고 있습니다.");
  const chunk = await renderBookPdfFrontChunk(book);
  await writeExportChunk({ userId: input.userId, jobId: input.jobId, chunkIndex: 0, bytes: chunk });
  await updateProgress(input.jobId, 10, "rendering", "표지와 목차를 완성했습니다. 본문을 이어서 만들고 있습니다.");
  return { status: "completed" as const, byteLength: chunk.byteLength };
}

export async function renderBackgroundPdfChapter(
  input: BackgroundExportInput,
  chapterIndex: number,
  expectedChapterCount: number
) {
  const job = await loadJob(input);
  if (job.status === "COMPLETED" && job.asset_id) return { status: "completed" as const };

  const book = await collectBook(input.bookId);
  const actualCount = pdfChapterCount(book);
  if (actualCount !== expectedChapterCount) throw new Error("PDF_OUTLINE_CHANGED_DURING_EXPORT");
  if (chapterIndex < 0 || chapterIndex >= actualCount) throw new Error(`PDF_CHAPTER_NOT_FOUND:${chapterIndex}`);

  const before = 10 + Math.floor((chapterIndex / Math.max(1, actualCount)) * 74);
  await updateProgress(
    input.jobId,
    Math.min(83, before),
    "rendering",
    `Chapter ${chapterIndex + 1}/${actualCount} PDF를 백그라운드에서 만들고 있습니다.`
  );

  const chunk = await renderBookPdfChapterChunk(book, chapterIndex);
  await writeExportChunk({
    userId: input.userId,
    jobId: input.jobId,
    chunkIndex: chapterIndex + 1,
    bytes: chunk
  });

  const after = 10 + Math.round(((chapterIndex + 1) / Math.max(1, actualCount)) * 74);
  await updateProgress(
    input.jobId,
    Math.min(84, after),
    "rendering",
    `Chapter ${chapterIndex + 1}/${actualCount} 완료 · 다음 조각을 준비하고 있습니다.`
  );
  return { status: "completed" as const, byteLength: chunk.byteLength };
}

export async function finalizeBackgroundPdfExport(input: BackgroundExportInput, chapterCount: number) {
  const job = await loadJob(input);
  if (job.status === "COMPLETED" && job.asset_id) {
    return { status: "completed" as const, assetId: String(job.asset_id) };
  }

  await updateProgress(input.jobId, 86, "merging", "완성된 PDF 조각을 하나의 파일로 합치고 있습니다.");
  const chunks: Buffer[] = [];
  for (let chunkIndex = 0; chunkIndex <= chapterCount; chunkIndex += 1) {
    chunks.push(await readExportChunk(input.userId, input.jobId, chunkIndex));
  }

  const book = await collectBook(input.bookId);
  if (pdfChapterCount(book) !== chapterCount) throw new Error("PDF_OUTLINE_CHANGED_DURING_EXPORT");
  const body = new Uint8Array(await mergeBookPdfChunks(book.title, chunks));
  return persistCompletedExport(input, body, book.title);
}

export async function generateAndPersistBookExport(input: BackgroundExportInput) {
  if (input.format === "pdf") {
    try {
      const plan = await prepareBackgroundPdfExport(input);
      if (plan.status === "completed") return plan;
      await renderBackgroundPdfFront(input);
      for (let index = 0; index < plan.chapterCount; index += 1) {
        await renderBackgroundPdfChapter(input, index, plan.chapterCount);
      }
      return finalizeBackgroundPdfExport(input, plan.chapterCount);
    } catch (error) {
      await markFailed(input.jobId, error);
      throw error;
    }
  }

  const job = await loadJob(input);
  if (job.status === "COMPLETED" && job.asset_id) return { status: "completed" as const, assetId: String(job.asset_id) };

  try {
    await updateProgress(input.jobId, 3, "collecting", "원고와 목차를 불러오고 있습니다. 이 화면을 닫아도 계속 진행됩니다.");
    const book = await collectBook(input.bookId);
    let body: Uint8Array;

    if (input.format === "epub") {
      await updateProgress(input.jobId, 35, "rendering", "EPUB 파일을 백그라운드에서 만들고 있습니다.");
      body = new Uint8Array(await renderBookEpub(book));
    } else if (input.format === "docx") {
      await updateProgress(input.jobId, 35, "rendering", "DOCX 파일을 백그라운드에서 만들고 있습니다.");
      body = new Uint8Array(await renderBookDocx(book));
    } else {
      await updateProgress(input.jobId, 55, "rendering", "텍스트 파일을 백그라운드에서 만들고 있습니다.");
      const markdown = bookToMarkdown(book);
      body = new TextEncoder().encode(input.format === "txt" ? stripMarkdown(markdown) : markdown);
    }

    return persistCompletedExport(input, body, book.title);
  } catch (error) {
    await markFailed(input.jobId, error);
    throw error;
  }
}
