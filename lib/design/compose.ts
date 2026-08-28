import { createServiceSupabase } from "@/lib/supabase/server";
import { builtInTemplates, chooseLayout } from "./templates";

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

export async function composeBookPages(bookId: string) {
  const supabase = createServiceSupabase();
  const { data: book, error } = await supabase.from("books")
    .select("id,title,subtitle,book_type,book_settings(template_id),parts(id,title,position,chapters(id,title,position,sections(id,title,position,content_markdown)))")
    .eq("id", bookId).single();
  if (error || !book) throw error ?? new Error("Book not found.");

  const setting = Array.isArray(book.book_settings) ? book.book_settings[0] : book.book_settings;
  const templateId = setting?.template_id ?? "modern-editorial";
  const dna = builtInTemplates.find((t) => t.id === templateId) ?? builtInTemplates[0];
  const rows: any[] = [];
  let pageNumber = 1;

  rows.push({
    book_id: bookId, page_number: pageNumber++, layout_type: "Cover", template_id: dna.id,
    content: { title: book.title, subtitle: book.subtitle, designDNA: dna }
  });
  rows.push({
    book_id: bookId, page_number: pageNumber++, layout_type: "TableOfContents", template_id: dna.id,
    content: {
      parts: (book.parts as any[]).sort((a,b) => a.position-b.position).map((part) => ({
        title: part.title,
        chapters: part.chapters.sort((a:any,b:any) => a.position-b.position).map((chapter:any) => chapter.title)
      }))
    }
  });

  for (const part of (book.parts as any[]).sort((a,b) => a.position-b.position)) {
    for (const chapter of part.chapters.sort((a:any,b:any) => a.position-b.position)) {
      rows.push({
        book_id: bookId, page_number: pageNumber++, layout_type: "ChapterOpening", template_id: dna.id,
        content: { partTitle: part.title, chapterTitle: chapter.title }
      });
      for (const section of chapter.sections.sort((a:any,b:any) => a.position-b.position)) {
        const chunks = splitIntoPageChunks(section.content_markdown ?? "", book.book_type.includes("소설") ? 310 : 250);
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
  await supabase.from("book_covers").delete().eq("book_id", bookId);
  await supabase.from("book_covers").insert({
    book_id: bookId,
    concept: {
      title: book.title, subtitle: book.subtitle, templateId: dna.id, mood: dna.mood,
      palette: dna.colorStrategy, typography: dna.headingStyle, composition: dna.chapterOpeningStyle
    },
    is_selected: true
  });
  return { pageCount: rows.length, templateId: dna.id };
}
