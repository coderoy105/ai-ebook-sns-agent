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

  return (
    <AppShell>
      <section className="hero">
        <div>
          <div className="eyebrow">Your publishing desk</div>
          <h1>아이디어에서 완성된 책까지.</h1>
        </div>
        <div>
          <p className="hero-copy">AI가 기획, 장문 집필, 기억, 일관성 검사, 편집, 디자인, 내보내기를 하나의 프로젝트로 관리합니다.</p>
          <div className="actions">
            <Link className="button" href="/books/new">새 책 만들기</Link>
          </div>
        </div>
      </section>

      {books.length === 0 ? (
        <section className="panel">
          <div className="eyebrow">Empty library</div>
          <h2 style={{ marginTop: 8 }}>첫 번째 책을 시작하세요.</h2>
          <p className="muted">주제 한 줄만 적어도 독자, 장르, 제목, 목차와 분량을 자동 설계할 수 있습니다.</p>
          <Link className="button" href="/books/new">Quick Create</Link>
        </section>
      ) : (
        <section className="grid">
          {books.map((book) => (
            <Link key={book.id} href={`/books/${book.id}`} className="book-card">
              <div className="cover">
                <span className="cover-kicker">{book.book_type}</span>
                <span className="cover-title">{book.title}</span>
                <span className="cover-kicker">{book.target_pages} pages target</span>
              </div>
              <div className="meta-row">
                <div>
                  <strong>{book.title}</strong>
                  <div className="muted" style={{ fontSize: 12 }}>{Math.round(book.progress)}% · {book.status}</div>
                </div>
                <span className="status">{book.status}</span>
              </div>
            </Link>
          ))}
        </section>
      )}
    </AppShell>
  );
}
