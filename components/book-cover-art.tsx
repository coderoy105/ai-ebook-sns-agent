"use client";

import type { CSSProperties } from "react";
import { normalizeCoverConcept, type CoverConcept } from "@/lib/design/cover-system";
import styles from "./book-cover-art.module.css";

type Props = {
  concept?: unknown;
  title: string;
  subtitle?: string | null;
  bookType?: string | null;
  compact?: boolean;
  className?: string;
};

type CoverCssVars = CSSProperties & {
  "--cover-bg": string;
  "--cover-fg": string;
  "--cover-accent": string;
  "--cover-secondary": string;
};

export function BookCoverArt({ concept: rawConcept, title, subtitle, bookType, compact = false, className = "" }: Props) {
  const concept: CoverConcept = normalizeCoverConcept(rawConcept, { title, subtitle, bookType });
  const vars: CoverCssVars = {
    "--cover-bg": concept.palette.background,
    "--cover-fg": concept.palette.foreground,
    "--cover-accent": concept.palette.accent,
    "--cover-secondary": concept.palette.secondary
  };

  return (
    <div
      className={`${styles.cover} ${compact ? styles.compact : ""} ${className}`.trim()}
      data-composition={concept.composition}
      data-typography={concept.typography.family}
      style={vars}
      aria-label={`${title} 표지 · ${concept.styleLabel}`}
    >
      <div className={styles.art} aria-hidden="true">
        <span className={styles.frame} />
        <span className={styles.orb} />
        <span className={styles.lineA} />
        <span className={styles.lineB} />
        <span className={styles.block} />
        <span className={styles.threadA} />
        <span className={styles.threadB} />
        <span className={styles.dotA} />
        <span className={styles.dotB} />
        <span className={styles.dotC} />
        <span className={styles.window} />
        <span className={styles.horizon} />
        <span className={styles.signalA} />
        <span className={styles.signalB} />
        <span className={styles.signalC} />
      </div>
      <div className={`${styles.copy} ${concept.typography.alignment === "center" ? styles.center : ""}`}>
        <span className={styles.kicker}>{concept.kicker}</span>
        <span className={styles.motif}>{concept.motifLabel}</span>
        <strong className={`${styles.title} ${concept.typography.titleScale === "xlarge" ? styles.xlarge : ""}`}>{title}</strong>
        {!compact && subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
      </div>
    </div>
  );
}
