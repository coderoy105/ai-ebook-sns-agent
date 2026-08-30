import { createServiceSupabase } from "@/lib/supabase/server";
import { collectBook, bookToMarkdown, stripMarkdown } from "./collect";
import { renderBookPdf } from "./pdf";
import { renderBookEpub } from "./epub";
import { renderBookDocx } from "./docx";
import { writeExportArtifact } from "./artifact-store";
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

async function updateProgress(jobId: string, progress: number, phase: ExportProgressPhase, message: string) {
  const supabase = createServiceSupabase();
  const { error } = await supabase.from("export_jobs").update({
    status: "RUNNING",
    error_message: encodeExportProgress({ progress, phase, message })
  }).eq("id", jobId);
  if (error) throw new Error(`EXPORT_PROGRESS_SAVE_FAILED:${error.message}`);
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

export async function generateAndPersistBookExport(input: BackgroundExportInput) {
  const supabase = createServiceSupabase();
  const { data: job, error: jobError } = await supabase.from("export_jobs")
    .select("id,book_id,user_id,format,status,asset_id")
    .eq("id", input.jobId)
    .eq("book_id", input.bookId)
    .eq("user_id", input.userId)
    .single();
  if (jobError || !job) throw new Error(jobError?.message ?? "EXPORT_JOB_NOT_FOUND");
  if (job.status === "COMPLETED" && job.asset_id) return { status: "completed", assetId: String(job.asset_id) };
  if (String(job.format).toLowerCase() !== input.format) throw new Error("EXPORT_FORMAT_MISMATCH");

  try {
    await updateProgress(input.jobId, 3, "collecting", "원고와 목차를 불러오고 있습니다. 이 화면을 닫아도 계속 진행됩니다.");
    const book = await collectBook(input.bookId);
    let body: Uint8Array;

    if (input.format === "pdf") {
      body = new Uint8Array(await renderBookPdf(book, async (progress, message) => {
        await updateProgress(input.jobId, progress, progress >= 90 ? "merging" : "rendering", `${message} 백그라운드에서 계속 진행됩니다.`);
      }));
    } else if (input.format === "epub") {
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

    if (!body.byteLength) throw new Error("EXPORT_EMPTY_FILE");
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
          title: book.title
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

    return { status: "completed", assetId, byteLength: body.byteLength };
  } catch (error) {
    await markFailed(input.jobId, error);
    throw error;
  }
}
