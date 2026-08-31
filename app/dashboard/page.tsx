"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { BookCoverArt } from "@/components/book-cover-art";
import { createClient } from "@/lib/supabase/client";

type JobState = { status?: string; progress?: number; created_at?: string };
type CoverResult = { concept?: unknown; is_selected?: boolean; created_at?: string };
type BookCard = {
  id: string;
  title: string;
  subtitle: string | null;
  book_type: string;
  status: string;
  progress: number;
  target_pages: number;
  updated_at: string;
  cover: unknown | null;
  latestJob: JobState | null;
};

type LibraryView = "all" | "generating" | "completed";

const activeJobStatuses = new Set(["QUEUED", "PLANNING", "RETRYING", "GENERATING", "WAITING_LIMIT", "PAUSED", "NEEDS_RECONNECT", "PAUSED_ERROR"]);

function statusLabel(status: string, jobStatus?: string) {
  if (jobStatus === "WAITING_LIMIT") return "사용 한도 대기";
  if (jobStatus === "NEEDS_RECONNECT") return "AI 재연결 필요";
  if (jobStatus === "PAUSED_ERROR") return "확인 필요";
  if (jobStatus === "RETRYING") return "자동 재시도";
  if (status === "GENERATING") return "집필 중";
  if (status === "PAUSED") return "일시정지";
  if (status === "COMPLETED") return "완성";
  if (status === "PLANNING") return "구성 중";
  if (status === "FAILED") return "확인 필요";
  return "초안";
}

function isActive(book: BookCard) {
  return activeJobStatuses.has(book.latestJob?.status ?? "") || !["COMPLETED", "CANCELLED"].includes(book.status);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(new Date(value));
}

function LoadingQueue() {
  return (
    <div className="manuscript-list manuscript-list-loading" aria-label="원고 목록 불러오는 중" aria-busy="true">
      {[0, 1, 2].map((item) => (
        <div className="manuscript-row manuscript-skeleton" key={item}>
          <span className="skeleton-block skeleton-index" />
          <span className="skeleton-block skeleton-spine" />
          <div className="skeleton-copy"><span /><span /><span /></div>
          <div className="skeleton-copy skeleton-progress"><span /><span /></div>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [books, setBooks] = useState<BookCard[]>([]);
  const [view, setView] = useState<LibraryView>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const requestedView = new URL(window.location.href).searchParams.get("view");
    const viewTimer = setTimeout(() => {
      if (requestedView === "generating" || requestedView === "completed") setView(requestedView);
    }, 0);

    let active = true;
    const supabase = createClient();
    void (async () => {
      try {
        const { data: userData } = await supabase.auth.getUser();
        if (!userData.user) {
          router.replace("/login?next=/dashboard");
          return;
        }
        const { data, error: queryError } = await supabase
          .from("books")
          .select("id,title,subtitle,book_type,status,progress,target_pages,updated_at,cover:book_covers(concept,is_selected,created_at),generation_jobs(status,progress,created_at)")
          .order("updated_at", { ascending: false });
        if (queryError) throw queryError;
        const normalized = (data ?? []).map((book) => {
          const jobs = Array.isArray(book.generation_jobs) ? [...book.generation_jobs] : [];
          jobs.sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
          const covers = (Array.isArray(book.cover) ? [...book.cover] : []) as CoverResult[];
          covers.sort((a, b) => Number(Boolean(b.is_selected)) - Number(Boolean(a.is_selected)) || new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
          return {
            ...book,
            cover: covers[0]?.concept ?? null,
            latestJob: jobs[0] ?? null
          };
        }) as BookCard[];
        if (active) setBooks(normalized);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "원고 목록을 불러오지 못했습니다.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; clearTimeout(viewTimer); };
  }, [router]);

  const activeCount = books.filter(isActive).length;
  const completedCount = books.filter((book) => book.status === "COMPLETED").length;
  const visibleBooks = useMemo(() => {
    if (view === "generating") return books.filter(isActive);
    if (view === "completed") return books.filter((book) => book.status === "COMPLETED");
    return books;
  }, [books, view]);

  function changeView(next: LibraryView) {
    setView(next);
    const url = next === "all" ? "/dashboard" : `/dashboard?view=${next}`;
    window.history.replaceState(null, "", url);
  }

  return (
    <AppShell>
      <section className="dashboard-head">
        <div className="dashboard-title-block">
          <span className="page-eyebrow">Library</span>
          <h1>작업 중인 원고</h1>
          <p>책의 구조, 집필 상태, 수정 기록과 내보내기를 한 흐름에서 관리합니다.</p>
        </div>
        <div className="dashboard-head-actions">
          <Link className="button button-primary" href="/books/new">새 책 만들기 <span aria-hidden="true">＋</span></Link>
          <span>자동 저장 · 백그라운드 생성</span>
        </div>
      </section>

      <section className="work-summary" aria-label="작업 요약">
        <div><strong>{books.length}</strong><span>전체 원고</span></div>
        <div><strong>{activeCount}</strong><span>진행 중</span></div>
        <div><strong>{completedCount}</strong><span>완성</span></div>
        <p>생성 상태와 완료된 Section은 서버에 저장되어 화면을 이동해도 이어집니다.</p>
      </section>

      {error ? <p className="notice" role="alert">{error}</p> : null}

      <section className="library-section" aria-labelledby="library-title">
        <div className="section-heading">
          <div>
            <span className="page-eyebrow">Projects</span>
            <h2 id="library-title">최근 프로젝트</h2>
          </div>
          <div className="library-tabs" role="tablist" aria-label="원고 필터">
            <button type="button" role="tab" aria-selected={view === "all"} className={view === "all" ? "active" : ""} onClick={() => changeView("all")}>전체 <span>{books.length}</span></button>
            <button type="button" role="tab" aria-selected={view === "generating"} className={view === "generating" ? "active" : ""} onClick={() => changeView("generating")}>진행 <span>{activeCount}</span></button>
            <button type="button" role="tab" aria-selected={view === "completed"} className={view === "completed" ? "active" : ""} onClick={() => changeView("completed")}>완성 <span>{completedCount}</span></button>
          </div>
        </div>

        {loading ? <LoadingQueue /> : null}

        {!loading && visibleBooks.length === 0 ? (
          <div className="empty-library">
            <div className="empty-sheet" aria-hidden="true"><span /><span /><span /><span /></div>
            <div>
              <h2>{books.length === 0 ? "첫 원고를 시작해 보세요." : "이 상태의 원고가 없습니다."}</h2>
              <p>{books.length === 0 ? "아이디어 한 문장에서 독자, 구조, 분량을 설계하고 실제 원고까지 이어서 작성합니다." : "필터를 바꾸거나 진행 중인 프로젝트의 상태를 확인해 보세요."}</p>
              {books.length === 0 ? <Link className="text-link" href="/books/new">첫 번째 책 만들기 <span aria-hidden="true">→</span></Link> : <button type="button" className="text-button" onClick={() => changeView("all")}>전체 원고 보기</button>}
            </div>
          </div>
        ) : null}

        {!loading && visibleBooks.length > 0 ? (
          <div className="manuscript-list">
            {visibleBooks.map((book, index) => {
              const storedProgress = Number(book.progress);
              const jobProgress = Number(book.latestJob?.progress ?? 0);
              const progress = Math.max(0, Math.min(100, book.status === "PLANNING" ? Math.max(storedProgress, jobProgress) : storedProgress));
              const state = (book.latestJob?.status || book.status).toLowerCase();
              return (
                <Link key={book.id} href={`/book?bookId=${encodeURIComponent(book.id)}`} className="manuscript-row">
                  <div className="manuscript-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</div>
                  <div style={{ width: 56 }} aria-hidden="true">
                    <BookCoverArt concept={book.cover} title={book.title} subtitle={book.subtitle} bookType={book.book_type} compact />
                  </div>
                  <div className="manuscript-copy">
                    <div className="manuscript-title-line"><strong>{book.title}</strong><span className={`manuscript-state state-${state}`}>{statusLabel(book.status, book.latestJob?.status)}</span></div>
                    <p>{book.subtitle || "부제 없이 작업 중인 원고"}</p>
                    <span>최근 수정 {formatDate(book.updated_at)} · {book.target_pages} pages</span>
                  </div>
                  <div className="manuscript-progress">
                    <div><span>진행률</span><strong>{Math.round(progress)}%</strong></div>
                    <div className="progress-track" aria-label={`진행률 ${Math.round(progress)}%`}><span style={{ width: `${progress}%` }} /></div>
                    <small>{progress >= 100 ? "내보내기 준비됨" : "서버 진행률"}</small>
                  </div>
                  <span className="row-arrow" aria-hidden="true">→</span>
                </Link>
              );
            })}
          </div>
        ) : null}
      </section>
    </AppShell>
  );
}
