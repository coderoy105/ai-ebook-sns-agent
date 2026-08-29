import Link from "next/link";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <div>
          <Link href="/dashboard" className="brand">
            <span>AI BOOK</span>
            <strong>STUDIO</strong>
          </Link>
          <nav className="nav" aria-label="주요 메뉴">
            <Link href="/dashboard"><span>Library</span><small>원고 작업실</small></Link>
            <Link href="/books/new"><span>Create</span><small>새 책 설계</small></Link>
            <Link href="/dashboard?view=generating"><span>Generation</span><small>생성 상태</small></Link>
          </nav>
        </div>
        <div className="sidebar-note">
          <span className="status-dot" aria-hidden="true" />
          <span>Free AI ready</span>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
