"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { paginateMeasuredManuscript } from "@/lib/pagination/manuscript";
import styles from "./paged-manuscript-editor.module.css";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

const PAGE_WIDTH = 794;
const PAGE_HEIGHT = 1123;

function roughPages(value: string) {
  return paginateMeasuredManuscript(value, (fragment) => fragment.length <= 1200);
}

function samePages(a: string[], b: string[]) {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

export function PagedManuscriptEditor({ value, onChange, placeholder, disabled }: Props) {
  const [pages, setPages] = useState<string[]>(() => roughPages(value));
  const [scale, setScale] = useState(1);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const firstEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const measureRef = useRef<HTMLTextAreaElement | null>(null);
  const repaginationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const repaginate = useCallback(() => {
    const editor = firstEditorRef.current;
    const measure = measureRef.current;
    if (!editor || !measure) return;
    const width = editor.clientWidth;
    const height = editor.clientHeight;
    if (width <= 0 || height <= 0) return;

    measure.style.width = `${width}px`;
    measure.style.height = `${height}px`;
    const fits = (fragment: string) => {
      measure.value = fragment || " ";
      return measure.scrollHeight <= height + 1;
    };
    const next = paginateMeasuredManuscript(value, fits);
    setPages((current) => samePages(current, next) ? current : next);
  }, [value]);

  useLayoutEffect(() => {
    if (repaginationTimer.current) clearTimeout(repaginationTimer.current);
    repaginationTimer.current = setTimeout(() => requestAnimationFrame(repaginate), 45);
    return () => {
      if (repaginationTimer.current) clearTimeout(repaginationTimer.current);
    };
  }, [repaginate]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateScale = () => {
      const available = Math.max(280, viewport.clientWidth);
      setScale(Math.min(1, available / PAGE_WIDTH));
    };
    updateScale();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateScale);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void document.fonts?.ready.then(() => {
      if (!cancelled) requestAnimationFrame(repaginate);
    });
    return () => { cancelled = true; };
  }, [repaginate]);

  function changePage(index: number, nextPage: string) {
    const nextPages = [...pages];
    nextPages[index] = nextPage;
    setPages(nextPages);
    onChange(nextPages.join(""));
  }

  return (
    <div className={styles.viewport} ref={viewportRef} aria-label="페이지 단위 원고 편집기">
      <div className={styles.stack} style={{ width: PAGE_WIDTH * scale }}>
        {pages.map((page, index) => (
          <div
            className={styles.pageSlot}
            key={`page-${index}`}
            style={{ width: PAGE_WIDTH * scale, height: PAGE_HEIGHT * scale }}
          >
            <article
              className={styles.page}
              style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, transform: `scale(${scale})` }}
            >
              <div className={styles.pageHeader} aria-hidden="true">
                <span>AI BOOK STUDIO</span>
                <span>{String(index + 1).padStart(2, "0")}</span>
              </div>
              <textarea
                ref={index === 0 ? firstEditorRef : undefined}
                className={styles.editor}
                aria-label={`section manuscript page ${index + 1}`}
                value={page}
                onChange={(event) => changePage(index, event.target.value)}
                placeholder={index === 0 ? placeholder : undefined}
                disabled={disabled}
                spellCheck
              />
              <footer className={styles.pageFooter} aria-hidden="true">
                <span>{index + 1}</span>
                <span>{pages.length} pages</span>
              </footer>
            </article>
          </div>
        ))}
      </div>
      <textarea ref={measureRef} className={styles.measure} aria-hidden="true" tabIndex={-1} readOnly />
    </div>
  );
}
