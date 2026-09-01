"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ProductMark } from "@/components/product-mark";
import { TitleStudioLauncher } from "@/components/title-studio-launcher";
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

function resolveBookIdFromLocation() {
  const current = new URL(window.location.href);
  const queryId = current.searchParams.get("bookId")?.trim();
  if (queryId) return queryId;

  // /books/:id is rewritten by Next.js to /book?bookId=:id. Rewrites keep the
  // browser-visible pathname, so window.location.search does not contain bookId.
  const pathMatch = current.pathname.match(/^\/books\/([^/?#]+)\/?$/u);
  if (!pathMatch?.[1]) return "";
  try {
    return decodeURIComponent(pathMatch[1]).trim();
  } catch {
    return pathMatch[1].trim();
  }
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
      const id = resolveBookIdFromLocation();
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
          router.replace(`/login?next=${encodeURIComponent(`/books/${id}`)}`);
          return;
        }
        const { data, error: queryError } = await supabase.from("books").select(`
          id,title,subtitle,idea,book_type,book_family,status,progress,target_pages,target_words,quality_score,quality_scores,
          parts(id,title,purpose,position,chapters(id,title,goal,position,status,target_words,word_count,sections(id,title,goal,position,status,target_words,word_count,content_markdown,summary,layout_hint))),
          generation_jobs(id,status,workflow_run_id,created_at),
          book_blueprints(blueprint,version,is_active),
          book_covers(id,concept,is_selected,created_at)
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

  const planningOnly = book.parts.length === 0 && ["PLANNING", "FAILED"].includes(book.status);
  return <>
    <BookEditorShell initialBook={book} />
    {planningOnly ? <TitleStudioLauncher bookId={book.id} title={book.title} /> : null}
    <GenerationProgress bookId={bookId} />
  </>;
}
