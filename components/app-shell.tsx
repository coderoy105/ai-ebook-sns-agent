"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ProductMark } from "./product-mark";
import styles from "./app-shell.module.css";

const navigation = [
  { href: "/dashboard", label: "작업실", meta: "Library", key: "library" },
  { href: "/books/new", label: "새 책", meta: "Create", key: "create" },
  { href: "/dashboard?view=generating", label: "생성", meta: "Workflow", key: "workflow" },
  { href: "/account", label: "계정", meta: "Security", key: "account" }
] as const;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const dashboardView = searchParams.get("view");

  return (
    <div className="shell">
      <a className="skip-link" href="#main-content">본문으로 건너뛰기</a>

      <header className="mobile-appbar">
        <ProductMark compact />
        <Link className="mobile-appbar-action" href={pathname.startsWith("/account") ? "/dashboard" : "/books/new"}>
          {pathname.startsWith("/account") ? "작업실" : <>새 책 <span aria-hidden="true">＋</span></>}
        </Link>
      </header>

      <aside className="sidebar">
        <div className="sidebar-top">
          <ProductMark />
          <nav className={`nav ${styles.navGrid}`} aria-label="주요 메뉴">
            {navigation.map((item) => {
              const active = item.key === "create"
                ? pathname.startsWith("/books/new")
                : item.key === "workflow"
                  ? pathname === "/dashboard" && dashboardView === "generating"
                  : item.key === "account"
                    ? pathname.startsWith("/account")
                    : pathname === "/dashboard" && dashboardView !== "generating";
              return (
                <Link key={item.href} href={item.href} className={active ? "active" : ""} aria-current={active ? "page" : undefined}>
                  <span>{item.label}</span>
                  <small>{item.meta}</small>
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="sidebar-footer">
          <div className="sidebar-note">
            <span className="status-dot" aria-hidden="true" />
            <span><strong>Background workflow</strong><small>화면을 닫아도 작업은 계속됩니다.</small></span>
          </div>
          <Link className="sidebar-create" href="/books/new">새 프로젝트 시작 <span aria-hidden="true">↗</span></Link>
        </div>
      </aside>
      <main className="main" id="main-content">{children}</main>
    </div>
  );
}
