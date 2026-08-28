import Link from "next/link";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/dashboard" className="brand">
          AI Book Studio
          <small>Publishing system</small>
        </Link>
        <nav className="nav">
          <Link href="/dashboard">Library</Link>
          <Link href="/books/new">Create a book</Link>
          <Link href="/dashboard?view=generating">Generation</Link>
        </nav>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}
