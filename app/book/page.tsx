"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { BookEditorShell } from "@/app/books/[id]/book-editor-shell";
import { GenerationProgress } from "@/app/books/[id]/generation-progress";
import type { Book } from "@/app/books/[id]/book-editor";

export default function BookWorkspacePage() {
  const [bookId, setBookId] = useState("");
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const id = new URL(window.location.href).searchParams.get("bookId")?.trim() ?? "";
    if (!id) {
      setError("BOOK_ID_REQUIRED");
      setLoading(false);
      return;
    }
    setBookId(id);
    const supabase = createClient();
    void (async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) {
          location.assign(`/login?next=${encodeURIComponent(`/book?bookId=${id}`)}`);
          return;
        }
        const { data, error: queryError } = await supabase.from("books").select(`
          id,title,subtitle,idea,book_type,book_family,status,progress,target_pages,target_words,quality_score,quality_scores,
          parts(id,title,purpose,position,chapters(id,title,goal,position,status,target_words,word_count,sections(id,title,goal,position,status,target_words,word_count,content_markdown,summary,layout_hint))),
          generation_jobs(id,status,workflow_run_id,created_at),
          book_blueprints(blueprint,version,is_active),
          book_covers(concept)
        `).eq("id", id).single();
        if (queryError || !data) throw new Error(queryError?.message ?? "BOOK_NOT_FOUND");
        if (active) setBook(data as unknown as Book);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "원고를 불러오지 못했습니다.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []);

  if (loading) return <main className="main"><p className="muted">원고를 불러오는 중입니다…</p></main>;
  if (!book || !bookId) {
    return (
      <main className="main">
        <p className="notice" role="alert">{error || "원고를 찾을 수 없습니다."}</p>
        <Link className="button secondary" href="/dashboard">작업실로 돌아가기</Link>
      </main>
    );
  }

  return <>
    <BookEditorShell initialBook={book} />
    <GenerationProgress bookId={bookId} />
  </>;
}
