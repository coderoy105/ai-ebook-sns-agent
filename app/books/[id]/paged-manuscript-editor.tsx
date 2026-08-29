"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import styles from "./paged-manuscript-editor.module.css";

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
};

const MIN_BREAK_SEARCH = 0.72;

function roughPages(value: string, size = 1200) {
  if (!value) return [""];
  const pages: string[] = [];
  for (let start = 0; start < value.length; start += size) pages.push(value.slice(start, start + size));
  return pages.length ? pages : [""];
}

function preferredBreak(text: string, start: number, hardEnd: number) {
  const minimum = start + Math.floor((hardEnd - start) * MIN_BREAK_SEARCH);
  const window = text.slice(minimum, hardEnd);
  const doubleNewline = window.lastIndexOf("\n\n");
  if (doubleNewline >= 0) return minimum + doubleNewline + 2;
  const newline = window.lastIndexOf("\n");
  if (newline >= 0) return minimum + newline + 1;
  const space = window.lastIndexOf(" ");
  if (space >= 0) return minimum + space + 1;
  return hardEnd;
}

function measuredPages(value: string, measure: HTMLTextAreaElement, width: number, maxHeight: number) {
  if (!value) return [""];
  if (width < 40 || maxHeight < 80) return roughPages(value);

  measure.style.width = `${width}px`;
  const fits = (fragment: string) => {
    measure.value = fragment || " ";
    return measure.scrollHeight <= maxHeight + 1;
  };

  const pages: string[] = [];
  let start = 0;
  while (start < value.length) {
    const remaining = value.slice(start);
    if (fits(remaining)) {
      pages.push(remaining);
      break;
    }

    let low = start + 1;
    let high = value.length;
    let best = low;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (fits(value.slice(start, mid))) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    let end = preferredBreak(value, start, best);
    if (end <= start) end = best;
    if (end <= start) end = Math.min(value.length, start + 1);
    pages.push(value.slice(start, end));
    start = end;
  }

  return pages.length ? pages : [""];
}

function samePages(a: string[], b: string[]) {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

export function PagedManuscriptEditor({ value, onChange, placeholder, disabled }: Props) {
  const [pages, setPages] = useState<string[]>(() => roughPages(value));
  const firstEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const measureRef = useRef<HTMLTextAreaElement | null>(null);
  const lastMetrics = useRef({ width: 0, height: 0 });

  const repaginate = useCallback(() => {
    const editor = firstEditorRef.current;
    const measure = measureRef.current;
    if (!editor || !measure) return;
    const width = editor.clientWidth;
    const height = editor.clientHeight;
    if (width <= 0 || height <= 0) return;
    lastMetrics.current = { width, height };
    const next = measuredPages(value, measure, width, height);
    setPages((current) => samePages(current, next) ? current : next);
  }, [value]);

  useLayoutEffect(() => {
    const frame = requestAnimationFrame(repaginate);
    const editor = firstEditorRef.current;
    if (!editor || typeof ResizeObserver === "undefined") return () => cancelAnimationFrame(frame);
    const observer = new ResizeObserver(() => requestAnimationFrame(repaginate));
    observer.observe(editor);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [repaginate]);

  function changePage(index: number, nextPage: string) {
    const nextPages = [...pages];
    nextPages[index] = nextPage;
    setPages(nextPages);
    onChange(nextPages.join(""));
  }

  return (
    <div className={styles.stack} aria-label="페이지 단위 원고 편집기">
      {pages.map((page, index) => (
        <article className={styles.page} key={`${index}-${pages.length}`}>
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
      ))}
      <textarea ref={measureRef} className={styles.measure} aria-hidden="true" tabIndex={-1} readOnly />
    </div>
  );
}
