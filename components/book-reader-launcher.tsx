"use client";

import Link from "next/link";
import styles from "./book-reader-launcher.module.css";

export function BookReaderLauncher({ bookId, completed }: { bookId: string; completed: boolean }) {
  return (
    <Link
      href={`/books/${bookId}/read`}
      className={`${styles.launcher} ${completed ? styles.ready : ""}`}
      aria-label={completed ? "완성본 책을 웹에서 읽기" : "현재 책 미리보기 열기"}
    >
      <span className={styles.bookIcon} aria-hidden="true"><i /><i /><i /></span>
      <span className={styles.copy}>
        <small>{completed ? "FINAL BOOK" : "BOOK PREVIEW"}</small>
        <strong>{completed ? "완성본 보기" : "책으로 보기"}</strong>
      </span>
      <span className={styles.arrow} aria-hidden="true">↗</span>
    </Link>
  );
}
