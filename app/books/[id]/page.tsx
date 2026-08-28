import { notFound } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { BookEditor } from "./book-editor";
import type { Book } from "./book-editor";

export default async function BookPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireUser();
  const { data: book, error } = await supabase.from("books").select(`
    id,title,subtitle,idea,book_type,book_family,status,progress,target_pages,target_words,quality_score,quality_scores,
    parts(id,title,purpose,position,chapters(id,title,goal,position,status,target_words,word_count,sections(id,title,goal,position,status,target_words,word_count,content_markdown,summary,layout_hint))),
    generation_jobs(id,status,workflow_run_id,created_at),
    book_blueprints(blueprint,version,is_active),
    book_covers(concept)
  `).eq("id", id).single();
  if (error || !book) notFound();
  return <BookEditor initialBook={book as unknown as Book} />;
}
