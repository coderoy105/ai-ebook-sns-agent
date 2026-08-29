import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { requireUser } from "@/lib/supabase/server";

type JobState = { status?: string; progress?: number; created_at?: string };
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
  latestJob: JobState | null;
};

function statusLabel(status: string, jobStatus?: string) {
  if (jobStatus === "WAITING_LIMIT") return "무료 한도 대기";
  if (jobStatus === "NEEDS_RECONNECT") return "AI 재연결 필요";
  if (jobStatus === "RETRYING") return "자동 재시도";
  if (status === "GENERATING") return "백그라운드 집필 중";
  if (status === "PAUSED") return "일시정지";
  if (status === "COMPLETED") return "완료";
  if (status === "PLANNING") return "백그라운드 기획 중";
  if (status === "FAILED") return "확인 필요";
  return "초안";
}

export default async function DashboardPage() {
  const { supabase } = await requireUser();
  const { data } = await supabase
    .from("books")
    .select("id,title,subtitle,book_type,status,progress,target_pages,updated_at,cover:book_covers(concept),generation_jobs(status,progress,created_at)")
    .order("updated_at", { ascending: false });

  const books = (data ?? []).map((book) => {
    const jobs = Array.isArray(book.generation_jobs) ? [...book.generation_jobs] : [];
    jobs.sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
    const latestJob = jobs[0] ?? null;
    return {
      ...book,
      cover: Array.isArray(book.cover) ? (book.cover[0]?.concept ?? null) : null,
      latestJob
    };
  }) as BookCard[];

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
        <p>기획과 원고 생성은 서버에 작업 상태가 저장되어 화면을 나가도 백그라운드에서 이어집니다.</p>
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
              const storedProgress = Number(book.progress);
              const jobProgress = Number(book.latestJob?.progress ?? 0);
              const progress = Math.max(0, Math.min(100, book.status === "PLANNING" ? Math.max(storedProgress, jobProgress) : storedProgress));
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
                  <div className={`manuscript-state state-${(book.latestJob?.status || book.status).toLowerCase()}`}>{statusLabel(book.status, book.latestJob?.status)}</div>
                </Link>
              );
            })}
          </div>
        </section>
      )}
    </AppShell>
  );
}
