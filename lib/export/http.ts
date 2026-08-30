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

export async function handleBookExport(bookId: string, rawFormat: string) {
  try {
    if (!(rawFormat in exportFormats)) return bad("Unsupported format");
    const exportFormat = rawFormat as ExportFormat;
    const { supabase, user } = await requireUser();
    await assertRateLimit(user.id, "book-export", 20, 3600);

    const { data: owned, error: ownedError } = await supabase
      .from("books")
      .select("id,title")
      .eq("id", bookId)
      .single();
    if (ownedError || !owned) return bad("Book not found", 404);

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

      if (body.byteLength === 0) throw new Error("EXPORT_EMPTY_FILE");

      if (job) {
        await supabase.from("export_jobs").update({
          status: "COMPLETED",
          error_message: null,
          finished_at: new Date().toISOString()
        }).eq("id", job.id);
      }

      const meta = exportFormats[exportFormat];
      return new Response(body as unknown as BodyInit, {
        status: 200,
        headers: {
          "content-type": meta.type,
          "content-length": String(body.byteLength),
          "content-disposition": contentDisposition(book.title, meta.ext),
          "cache-control": "private, no-store, max-age=0",
          "x-content-type-options": "nosniff"
        }
      });
    } catch (error) {
      if (job) {
        await supabase.from("export_jobs").update({
          status: "FAILED",
          error_message: error instanceof Error ? error.message : String(error),
          finished_at: new Date().toISOString()
        }).eq("id", job.id);
      }
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed";
    return bad(message, message === "UNAUTHORIZED" ? 401 : message === "RATE_LIMITED" ? 429 : 400);
  }
}
