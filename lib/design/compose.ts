import { createServiceSupabase } from "@/lib/supabase/server";
import { builtInTemplates, chooseLayout } from "./templates";
import { createCoverConcepts, normalizeCoverConcept } from "./cover-system";

type SectionRow = { id:string; title:string; position:number; content_markdown:string|null };
type ChapterRow = { id:string; title:string; position:number; sections:SectionRow[] };
type PartRow = { id:string; title:string; position:number; chapters:ChapterRow[] };
type CoverRow = { id:string; concept:unknown; is_selected:boolean; created_at:string };
type PageInsert = {
  book_id:string;
  page_number:number;
  layout_type:string;
  template_id:string;
  content:Record<string, unknown>;
};

function splitIntoPageChunks(markdown: string, targetWords = 260) {
  const paragraphs = markdown.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const pages: string[] = [];
  let current: string[] = [];
  let words = 0;
  for (const paragraph of paragraphs) {
    const count = paragraph.split(/\s+/u).filter(Boolean).length;
    if (current.length && words + count > targetWords) {
      pages.push(current.join("\n\n"));
      current = [];
      words = 0;
    }
    current.push(paragraph);
    words += count;
  }
  if (current.length) pages.push(current.join("\n\n"));
  return pages;
}

function activeBlueprintCoreMessage(value: unknown) {
  const rows = Array.isArray(value) ? value : [];
  const sorted = [...rows].sort((a, b) => Number((b as { version?: number }).version ?? 0) - Number((a as { version?: number }).version ?? 0));
  const active = sorted.find((row) => (row as { is_active?: boolean }).is_active !== false) as { blueprint?: unknown } | undefined;
  const blueprint = active?.blueprint && typeof active.blueprint === "object" ? active.blueprint as Record<string, unknown> : null;
  return typeof blueprint?.coreMessage === "string" ? blueprint.coreMessage : null;
}

export async function composeBookPages(bookId: string) {
  const supabase = createServiceSupabase();
  const { data: book, error } = await supabase.from("books")
    .select("id,title,subtitle,idea,book_type,book_settings(template_id),book_blueprints(blueprint,version,is_active),book_covers(id,concept,is_selected,created_at),parts(id,title,position,chapters(id,title,position,sections(id,title,position,content_markdown)))")
    .eq("id", bookId).single();
  if (error || !book) throw error ?? new Error("Book not found.");

  const setting = Array.isArray(book.book_settings) ? book.book_settings[0] : book.book_settings;
  const templateId = setting?.template_id ?? "modern-editorial";
  const dna = builtInTemplates.find((t) => t.id === templateId) ?? builtInTemplates[0];
  const rows: PageInsert[] = [];
  const parts = (book.parts ?? []) as unknown as PartRow[];
  const existingCovers = ((book.book_covers ?? []) as unknown as CoverRow[]).sort((a, b) => Number(b.is_selected) - Number(a.is_selected));
  const hasModernCovers = existingCovers.some((cover) => cover.concept && typeof cover.concept === "object" && (cover.concept as { version?: unknown }).version === 2);
  const coreMessage = activeBlueprintCoreMessage(book.book_blueprints);
  const generatedCovers = createCoverConcepts({
    title: String(book.title),
    subtitle: book.subtitle ? String(book.subtitle) : null,
    bookType: book.book_type ? String(book.book_type) : null,
    idea: book.idea ? String(book.idea) : null,
    coreMessage,
    templateMood: dna.mood
  });
  const selectedRaw = existingCovers.find((cover) => cover.is_selected)?.concept ?? existingCovers[0]?.concept ?? generatedCovers[0];
  const selectedCover = normalizeCoverConcept(selectedRaw, {
    title: String(book.title),
    subtitle: book.subtitle ? String(book.subtitle) : null,
    bookType: book.book_type ? String(book.book_type) : null,
    idea: book.idea ? String(book.idea) : null,
    coreMessage,
    templateMood: dna.mood
  });
  let pageNumber = 1;

  rows.push({
    book_id: bookId, page_number: pageNumber++, layout_type: "Cover", template_id: dna.id,
    content: { title: book.title, subtitle: book.subtitle, designDNA: dna, coverConcept: selectedCover }
  });
  rows.push({
    book_id: bookId, page_number: pageNumber++, layout_type: "TableOfContents", template_id: dna.id,
    content: {
      parts: [...parts].sort((a,b) => a.position-b.position).map((part) => ({
        title: part.title,
        chapters: [...part.chapters].sort((a,b) => a.position-b.position).map((chapter) => chapter.title)
      }))
    }
  });

  for (const part of [...parts].sort((a,b) => a.position-b.position)) {
    for (const chapter of [...part.chapters].sort((a,b) => a.position-b.position)) {
      rows.push({
        book_id: bookId, page_number: pageNumber++, layout_type: "ChapterOpening", template_id: dna.id,
        content: { partTitle: part.title, chapterTitle: chapter.title }
      });
      for (const section of [...chapter.sections].sort((a,b) => a.position-b.position)) {
        const chunks = splitIntoPageChunks(section.content_markdown ?? "", String(book.book_type).includes("소설") ? 310 : 250);
        for (const chunk of chunks) {
          rows.push({
            book_id: bookId, page_number: pageNumber++, layout_type: chooseLayout(chunk), template_id: dna.id,
            content: { sectionId: section.id, sectionTitle: section.title, markdown: chunk }
          });
        }
      }
    }
  }

  await supabase.from("pages").delete().eq("book_id", bookId);
  if (rows.length) {
    const { error: insertError } = await supabase.from("pages").insert(rows);
    if (insertError) throw insertError;
  }

  if (!hasModernCovers) {
    await supabase.from("book_covers").delete().eq("book_id", bookId);
    const { error: coverError } = await supabase.from("book_covers").insert(generatedCovers.map((concept, index) => ({
      book_id: bookId,
      concept,
      is_selected: index === 0
    })));
    if (coverError) throw coverError;
  }

  return { pageCount: rows.length, templateId: dna.id, coverStyle: selectedCover.style };
}
