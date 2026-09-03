"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { BookCoverArt } from "@/components/book-cover-art";
import styles from "./read.module.css";

type ReaderBook = {
  id: string;
  title: string;
  subtitle: string | null;
  bookType: string;
  status: string;
  targetPages: number;
  updatedAt: string | null;
};

type ReaderPageRow = {
  id: string;
  page_number: number;
  layout_type: string;
  template_id: string;
  content: Record<string, unknown>;
};

type ReaderPayload = {
  book: ReaderBook;
  pages: ReaderPageRow[];
  pageCount: number;
  final: boolean;
};

function resolveBookIdFromLocation() {
  const current = new URL(window.location.href);
  const queryId = current.searchParams.get("bookId")?.trim();
  if (queryId) return queryId;
  const match = current.pathname.match(/^\/books\/([^/?#]+)\/read\/?$/u);
  if (!match?.[1]) return "";
  try { return decodeURIComponent(match[1]).trim(); }
  catch { return match[1].trim(); }
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function cleanInline(value: string) {
  return value
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[~*_]/g, "")
    .trim();
}

function renderMarkdown(markdown: string): ReactNode[] {
  const blocks = markdown.split(/\n{2,}/u).map((block) => block.trim()).filter(Boolean);
  return blocks.map((block, index) => {
    if (/^```/u.test(block)) {
      return <pre className={styles.codeBlock} key={index}>{block.replace(/^```[^\n]*\n?/u, "").replace(/```$/u, "").trim()}</pre>;
    }

    const lines = block.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return null;

    if (lines.every((line) => /^[-*+]\s+/u.test(line) || /^[-*+]\s+\[[ xX]\]\s+/u.test(line))) {
      return <ul className={styles.list} key={index}>{lines.map((line, lineIndex) => {
        const checked = /^[-*+]\s+\[[xX]\]/u.test(line);
        const item = cleanInline(line.replace(/^[-*+]\s+(?:\[[ xX]\]\s*)?/u, ""));
        return <li key={lineIndex}>{/\[[ xX]\]/u.test(line) ? <span className={checked ? styles.checked : styles.unchecked}>{checked ? "✓" : "○"}</span> : null}<span>{item}</span></li>;
      })}</ul>;
    }

    if (lines.every((line) => line.startsWith(">"))) {
      return <blockquote className={styles.quote} key={index}>{cleanInline(lines.map((line) => line.replace(/^>\s?/u, "")).join(" "))}</blockquote>;
    }

    if (lines.length >= 2 && lines.every((line) => line.includes("|"))) {
      return <div className={styles.tableLike} key={index}>{lines.map((line, lineIndex) => <div key={lineIndex}>{cleanInline(line.replace(/^\||\|$/g, "").replace(/\|/g, " · "))}</div>)}</div>;
    }

    const first = lines[0];
    if (/^###\s+/u.test(first)) return <h3 className={styles.markdownH3} key={index}>{cleanInline(lines.join(" ").replace(/^###\s+/u, ""))}</h3>;
    if (/^##\s+/u.test(first)) return <h2 className={styles.markdownH2} key={index}>{cleanInline(lines.join(" ").replace(/^##\s+/u, ""))}</h2>;
    if (/^#\s+/u.test(first)) return <h2 className={styles.markdownH2} key={index}>{cleanInline(lines.join(" ").replace(/^#\s+/u, ""))}</h2>;

    return <p className={styles.bodyCopy} key={index}>{cleanInline(lines.join(" "))}</p>;
  });
}

function TocPage({ content }: { content: Record<string, unknown> }) {
  const parts = Array.isArray(content.parts) ? content.parts : [];
  return <div className={styles.toc}>
    <span className={styles.eyebrow}>CONTENTS</span>
    <h2>목차</h2>
    <div className={styles.tocList}>{parts.map((rawPart, partIndex) => {
      const part = record(rawPart);
      const chapters = Array.isArray(part.chapters) ? part.chapters : [];
      return <section key={partIndex}>
        <strong>{text(part.title, `Part ${partIndex + 1}`)}</strong>
        <ol>{chapters.map((chapter, chapterIndex) => <li key={chapterIndex}><span>{String(chapterIndex + 1).padStart(2, "0")}</span>{text(chapter)}</li>)}</ol>
      </section>;
    })}</div>
  </div>;
}

function ReaderSheet({ page, book }: { page: ReaderPageRow; book: ReaderBook }) {
  const content = record(page.content);
  const layout = page.layout_type;

  let inner: ReactNode;
  if (layout === "Cover") {
    inner = <div className={styles.coverWrap}>
      <BookCoverArt
        concept={content.coverConcept}
        title={text(content.title, book.title)}
        subtitle={text(content.subtitle, book.subtitle ?? "") || null}
        bookType={book.bookType}
      />
    </div>;
  } else if (layout === "TableOfContents") {
    inner = <TocPage content={content} />;
  } else if (layout === "ChapterOpening") {
    inner = <div className={styles.chapterOpening}>
      <span>{text(content.partTitle, "BOOK")}</span>
      <div className={styles.chapterRule} />
      <h2>{text(content.chapterTitle, "Chapter")}</h2>
      <small>{String(page.page_number).padStart(2, "0")}</small>
    </div>;
  } else {
    const sectionTitle = text(content.sectionTitle);
    const markdown = text(content.markdown);
    inner = <div className={styles.manuscriptPage} data-layout={layout}>
      <div className={styles.pageKicker}><span>{book.title}</span><span>{layout.replace(/([a-z])([A-Z])/g, "$1 $2")}</span></div>
      {sectionTitle ? <h2 className={styles.sectionTitle}>{sectionTitle}</h2> : null}
      <div className={styles.markdown}>{renderMarkdown(markdown)}</div>
    </div>;
  }

  return <article className={`${styles.sheet} ${layout === "Cover" ? styles.coverSheet : ""}`} data-reader-page={page.page_number} data-layout={layout}>
    <div className={styles.sheetInner}>{inner}</div>
    {layout !== "Cover" ? <footer className={styles.pageFooter}><span>AI BOOK STUDIO</span><b>{page.page_number}</b></footer> : null}
  </article>;
}

export default function BookReadPage() {
  const router = useRouter();
  const [bookId, setBookId] = useState("");
  const [data, setData] = useState<ReaderPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activePage, setActivePage] = useState(1);
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const id = resolveBookIdFromLocation();
    setBookId(id);
    if (!id) { setError("원고 ID가 없습니다."); setLoading(false); return; }

    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/books/${id}/reader`, { cache: "no-store" });
        if (response.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(`/books/${id}/read`)}`);
          return;
        }
        const payload = await response.json();
        if (!response.ok) {
          if (payload.error === "BOOK_NOT_COMPLETED") throw new Error("책 생성이 완료되면 완성본 보기를 사용할 수 있습니다.");
          if (payload.error === "BOOK_PAGES_NOT_READY") throw new Error("완성본 페이지를 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.");
          throw new Error(payload.error ?? "완성본을 불러오지 못했습니다.");
        }
        if (active) setData(payload as ReaderPayload);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : "완성본을 불러오지 못했습니다.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [router]);

  useEffect(() => {
    if (!data?.pages.length) return;
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-reader-page]"));
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      const value = Number((visible?.target as HTMLElement | undefined)?.dataset.readerPage ?? 0);
      if (value > 0) setActivePage(value);
    }, { rootMargin: "-20% 0px -45% 0px", threshold: [0.05, 0.25, 0.5] });
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [data]);

  useEffect(() => {
    const update = () => {
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      setScrollProgress(Math.max(0, Math.min(100, (window.scrollY / max) * 100)));
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { window.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, []);

  const pageLabel = useMemo(() => data ? `${activePage} / ${data.pageCount}` : "", [activePage, data]);

  if (loading) return <main className={styles.statePage}><div className={styles.loader}><i /><i /></div><strong>완성본을 조판하고 있습니다.</strong><span>저장된 원고를 웹 책으로 준비하는 중입니다.</span></main>;

  if (!data) return <main className={styles.statePage}>
    <span className={styles.stateEyebrow}>BOOK READER</span>
    <h1>완성본을 열 수 없습니다.</h1>
    <p>{error}</p>
    <Link href={bookId ? `/books/${bookId}` : "/dashboard"} className={styles.backButton}>원고 편집으로 돌아가기</Link>
  </main>;

  return <main className={styles.reader}>
    <header className={styles.toolbar}>
      <div className={styles.progressRail}><span style={{ width: `${scrollProgress}%` }} /></div>
      <div className={styles.toolbarInner}>
        <Link className={styles.brand} href="/dashboard"><span aria-hidden="true"><i /><i /></span><b>AI Book Studio</b></Link>
        <div className={styles.bookIdentity}><small>{data.final ? "FINAL BOOK" : "PREVIEW"}</small><strong>{data.book.title}</strong></div>
        <div className={styles.toolbarActions}>
          <span className={styles.pageCounter}>{pageLabel}</span>
          <Link href={`/books/${data.book.id}`} className={styles.toolButton}>편집</Link>
          <a href={`/api/books/${data.book.id}/export/pdf`} className={styles.primaryTool}>PDF</a>
        </div>
      </div>
    </header>

    <section className={styles.readerIntro}>
      <span>{data.book.bookType}</span>
      <h1>{data.book.title}</h1>
      {data.book.subtitle ? <p>{data.book.subtitle}</p> : null}
      <div><b>{data.pageCount}</b><small>pages</small><i /><b>{data.final ? "완성본" : "미리보기"}</b><small>web reader</small></div>
    </section>

    <section className={styles.stream} aria-label={`${data.book.title} 완성본`}>
      {data.pages.map((page) => <ReaderSheet key={page.id} page={page} book={data.book} />)}
    </section>

    <footer className={styles.endMatter}>
      <span>END OF BOOK</span>
      <h2>{data.book.title}</h2>
      <p>완성본을 모두 읽었습니다.</p>
      <div><Link href={`/books/${data.book.id}`}>원고 편집</Link><a href={`/api/books/${data.book.id}/export/pdf`}>PDF 내보내기</a></div>
    </footer>
  </main>;
}
