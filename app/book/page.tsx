"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ProductMark } from "@/components/product-mark";
import { createClient } from "@/lib/supabase/client";
import { BookEditorShell } from "@/app/books/[id]/book-editor-shell";
import { GenerationProgress } from "@/app/books/[id]/generation-progress";
import type { Book } from "@/app/books/[id]/book-editor";

function WorkspaceLoading() {
  return (
    <main className="workspace-loading" aria-label="원고를 불러오는 중" aria-busy="true">
      <div className="workspace-loading-rail"><span /><span /><span /><span /></div>
      <div className="workspace-loading-paper"><i /><i /><i /><i /><i /></div>
      <div className="workspace-loading-tools"><span /><span /><span /></div>
    </main>
  );
}

export default function BookWorkspacePage() {
  const router = useRouter();
  const [bookId, setBookId] = useState("");
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const supabase = createClient();
    void (async () => {
      await Promise.resolve();
      const id = new URL(window.location.href).searchParams.get("bookId")?.trim() ?? "";
      if (!active) return;
      if (!id) {
        setError("원고 ID가 없습니다.");
        setLoading(false);
        return;
      }
      setBookId(id);
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) {
          router.replace(`/login?next=${encodeURIComponent(`/book?bookId=${id}`)}`);
          return;
        }
        const { data, error: queryError } = await supabase.from("books").select(`
          id,title,subtitle,idea,book_type,book_family,status,progress,target_pages,target_words,quality_score,quality_scores,
          parts(id,title,purpose,position,chapters(id,title,goal,position,status,target_words,word_count,sections(id,title,goal,position,status,target_words,word_count,content_markdown,summary,layout_hint))),
          generation_jobs(id,status,workflow_run_id,created_at),
          book_blueprints(blueprint,version,is_active),
          book_covers(concept)
        `).eq("id", id).single();
        if (queryError || !data) throw new Error(queryError?.message ?? "원고를 찾을 수 없습니다.");
        if (active) setBook(data as unknown as Book);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "원고를 불러오지 못했습니다.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [router]);

  if (loading) return <WorkspaceLoading />;
  if (!book || !bookId) {
    return (
      <main className="workspace-error">
        <ProductMark />
        <div>
          <span>Workspace unavailable</span>
          <h1>원고를 열 수 없습니다.</h1>
          <p className="notice" role="alert">{error || "원고를 찾을 수 없습니다."}</p>
          <Link className="button button-primary" href="/dashboard">작업실로 돌아가기</Link>
        </div>
      </main>
    );
  }

  return <>
    <BookEditorShell initialBook={book} />
    <GenerationProgress bookId={bookId} />
  </>;
}
