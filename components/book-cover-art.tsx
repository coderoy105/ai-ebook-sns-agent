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
  "--cover-angle": string;
  "--cover-shift": string;
  "--cover-scale": string;
};

function titleLength(value: string) {
  const length = value.replace(/\s+/g, "").length;
  if (length >= 26) return "long";
  if (length >= 15) return "medium";
  return "short";
}

export function BookCoverArt({ concept: rawConcept, title, subtitle, bookType, compact = false, className = "" }: Props) {
  const concept: CoverConcept = normalizeCoverConcept(rawConcept, { title, subtitle, bookType });
  const angle = (concept.seed % 13) - 6;
  const shift = 6 + (concept.seed % 14);
  const scale = 92 + (concept.seed % 13);
  const vars: CoverCssVars = {
    "--cover-bg": concept.palette.background,
    "--cover-fg": concept.palette.foreground,
    "--cover-accent": concept.palette.accent,
    "--cover-secondary": concept.palette.secondary,
    "--cover-angle": `${angle}deg`,
    "--cover-shift": `${shift}%`,
    "--cover-scale": `${scale}%`
  };

  return (
    <div
      className={`${styles.cover} ${compact ? styles.compact : ""} ${className}`.trim()}
      data-composition={concept.composition}
      data-typography={concept.typography.family}
      data-layout={concept.layout}
      data-finish={concept.finish}
      data-style={concept.style}
      data-title-length={titleLength(title)}
      style={vars}
      aria-label={`${title} 표지 · ${concept.styleLabel}`}
    >
      <span className={styles.spine} aria-hidden="true" />
      <span className={styles.paper} aria-hidden="true" />

      <div className={styles.art} aria-hidden="true">
        <span className={styles.frame} />
        <span className={styles.orb} />
        <span className={styles.ring} />
        <span className={styles.lineA} />
        <span className={styles.lineB} />
        <span className={styles.block} />
        <span className={styles.blockGhost} />
        <span className={styles.threadA} />
        <span className={styles.threadB} />
        <span className={styles.dotA} />
        <span className={styles.dotB} />
        <span className={styles.dotC} />
        <span className={styles.dotD} />
        <span className={styles.window} />
        <span className={styles.horizon} />
        <span className={styles.signalA} />
        <span className={styles.signalB} />
        <span className={styles.signalC} />
        <span className={styles.gridMark} />
        <span className={styles.cropMark} />
      </div>

      <div className={styles.topline}>
        <span>{concept.kicker}</span>
        <span>{concept.catalogue}</span>
      </div>

      <div className={`${styles.copy} ${concept.typography.alignment === "center" ? styles.center : ""}`}>
        <span className={styles.motif}>{concept.motifLabel}</span>
        <strong className={`${styles.title} ${concept.typography.titleScale === "xlarge" ? styles.xlarge : ""}`}>{title}</strong>
        {!compact && subtitle ? <span className={styles.subtitle}>{subtitle}</span> : null}
      </div>

      <div className={styles.footer}>
        <span className={styles.imprintMark} aria-hidden="true"><i /><i /></span>
        <span className={styles.imprint}>{concept.imprint}</span>
        <span className={styles.edition}>{concept.editionLabel}</span>
      </div>
    </div>
  );
}
