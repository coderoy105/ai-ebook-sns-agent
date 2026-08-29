import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/supabase/server";

type BookCard = {
  id: string;
  title: string;
  subtitle: string | null;
  book_type: string;
  status: string;
  progress: number;
  target_pages: number;
  updated_at: string;
  cover: { palette?: string[] } | null;
};

function statusLabel(status: string) {
  if (status === "GENERATING") return "집필 중";
  if (status === "PAUSED") return "일시정지";
  if (status === "COMPLETED") return "완료";
  if (status === "PLANNING") return "구성 중";
  if (status === "FAILED") return "확인 필요";
  return "초안";
}

export default async function DashboardPage() {
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("books")
    .select("id,title,subtitle,book_type,status,progress,target_pages,updated_at,cover:book_covers(concept)")
    .order("updated_at", { ascending: false });

  const books = (data ?? []).map((book) => ({
    ...book,
    cover: Array.isArray(book.cover) ? (book.cover[0]?.concept ?? null) : null
  })) as BookCard[];

  const activeCount = books.filter((book) => !["COMPLETED", "CANCELLED"].includes(book.status)).length;

  return (
    <AppShell>
      <section className="dashboard-head">
        <div>
          <h1>책을 쓰는 과정이<br />한눈에 보이게.</h1>
          <p>기획부터 장문 집필, 수정, 버전 관리, 내보내기까지 한 원고 안에서 이어집니다.</p>
        </div>
        <Link className="button button-primary" href="/books/new">새 책 시작</Link>
      </section>

      <section className="work-summary" aria-label="작업 요약">
        <div><strong>{books.length}</strong><span>전체 원고</span></div>
        <div><strong>{activeCount}</strong><span>진행 중</span></div>
        <div><strong>{books.filter((book) => book.status === "COMPLETED").length}</strong><span>완성</span></div>
        <p>무료 AI 생성은 Section 단위로 저장되며 중간에 멈춰도 이어서 작업할 수 있습니다.</p>
      </section>

      {books.length === 0 ? (
        <section className="empty-library">
          <div className="empty-sheet" aria-hidden="true"><span /><span /><span /><span /></div>
          <div>
            <h2>아직 원고가 없습니다.</h2>
            <p>한 문장으로 시작하면 독자, 장르, 목차와 분량을 설계한 뒤 실제 원고까지 이어서 작성합니다.</p>
            <Link className="text-link" href="/books/new">첫 번째 책 설계하기</Link>
          </div>
        </section>
      ) : (
        <section className="library-section">
          <div className="section-heading">
            <h2>Manuscript queue</h2>
            <span>{books.length} projects</span>
          </div>
          <div className="manuscript-list">
            {books.map((book) => {
              const progress = Math.max(0, Math.min(100, Number(book.progress)));
              return (
                <Link key={book.id} href={`/books/${book.id}`} className="manuscript-row">
                  <div className="book-spine" aria-hidden="true">
                    <span>{book.book_type}</span>
                    <strong>{book.title}</strong>
                    <small>{book.target_pages}P</small>
                  </div>
                  <div className="manuscript-copy">
                    <strong>{book.title}</strong>
                    <p>{book.subtitle || "부제 없이 작업 중인 원고"}</p>
                    <span>마지막 작업 {new Date(book.updated_at).toLocaleDateString("ko-KR")}</span>
                  </div>
                  <div className="manuscript-progress">
                    <div><span>진행률</span><strong>{Math.round(progress)}%</strong></div>
                    <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
                  </div>
                  <div className={`manuscript-state state-${book.status.toLowerCase()}`}>{statusLabel(book.status)}</div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </AppShell>
  );
}
