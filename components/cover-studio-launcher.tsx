"use client";

import { useMemo, useState } from "react";
import { BookCoverArt } from "./book-cover-art";
import { CoverStudio, type CoverRow } from "./cover-studio";
import styles from "./cover-studio-launcher.module.css";

type Props = {
  bookId: string;
  title: string;
  subtitle?: string | null;
  bookType?: string | null;
  covers?: CoverRow[];
};

export function CoverStudioLauncher({ bookId, title, subtitle, bookType, covers = [] }: Props) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => covers.find((cover) => cover.is_selected) ?? covers[0] ?? null, [covers]);

  return (
    <>
      {open ? (
        <section className={styles.drawer} aria-label="표지 스튜디오">
          <div className={styles.drawerHead}>
            <strong>Cover Direction</strong>
            <button type="button" onClick={() => setOpen(false)}>닫기</button>
          </div>
          <CoverStudio bookId={bookId} title={title} subtitle={subtitle} bookType={bookType} initialCovers={covers} />
        </section>
      ) : null}
      <button type="button" className={styles.launcher} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        <span className={styles.thumb}><BookCoverArt concept={selected?.concept} title={title} subtitle={subtitle} bookType={bookType} compact /></span>
        <span>표지 스튜디오</span>
      </button>
    </>
  );
}
