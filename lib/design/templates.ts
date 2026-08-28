export type DesignDNA = {
  id: string;
  name: string;
  mood: string;
  colorStrategy: string[];
  typographyScale: "compact" | "balanced" | "dramatic";
  spacingScale: "tight" | "balanced" | "airy";
  contentWidth: "narrow" | "medium" | "wide";
  headingStyle: string;
  bodyStyle: string;
  visualDensity: "low" | "medium" | "high";
  alignment: "left" | "centered-mix";
  decorativeStyle: string;
  chapterOpeningStyle: string;
  quoteStyle: string;
  tableStyle: string;
  pageNumberStyle: string;
};

export const builtInTemplates: DesignDNA[] = [
  {
    id: "modern-editorial", name: "Modern Editorial", mood: "calm, premium, editorial",
    colorStrategy: ["paper", "charcoal", "rust accent"], typographyScale: "dramatic", spacingScale: "airy",
    contentWidth: "medium", headingStyle: "serif display", bodyStyle: "high-readability serif",
    visualDensity: "low", alignment: "left", decorativeStyle: "thin rules and restrained captions",
    chapterOpeningStyle: "oversized number + title", quoteStyle: "wide margin pull quote",
    tableStyle: "rule-based", pageNumberStyle: "outer-bottom"
  },
  {
    id: "minimal-tech", name: "Minimal Tech", mood: "precise, technical, modern",
    colorStrategy: ["white", "ink", "signal blue"], typographyScale: "balanced", spacingScale: "balanced",
    contentWidth: "wide", headingStyle: "clean sans", bodyStyle: "neutral sans",
    visualDensity: "medium", alignment: "left", decorativeStyle: "labels and keylines",
    chapterOpeningStyle: "title + chapter objective", quoteStyle: "boxed note",
    tableStyle: "dense grid", pageNumberStyle: "footer-center"
  },
  {
    id: "quiet-fiction", name: "Quiet Fiction", mood: "literary, immersive, quiet",
    colorStrategy: ["warm white", "ink"], typographyScale: "balanced", spacingScale: "airy",
    contentWidth: "narrow", headingStyle: "classic serif", bodyStyle: "book serif",
    visualDensity: "low", alignment: "centered-mix", decorativeStyle: "minimal ornaments",
    chapterOpeningStyle: "centered chapter title", quoteStyle: "indented",
    tableStyle: "minimal", pageNumberStyle: "bottom-center"
  }
];

export function chooseLayout(markdown: string) {
  const text = markdown.toLowerCase();
  if (/^\s*>\s/m.test(markdown)) return "Quote";
  if (/\|.+\|/.test(markdown)) return "Table";
  if (/```/.test(markdown)) return "CodeExample";
  if (/\bvs\.?\b|비교|versus/.test(text)) return "Comparison";
  if (/\b\d{4}\b.*\b\d{4}\b|timeline|연표/.test(text)) return "Timeline";
  if (/checklist|체크리스트|^- \[[ x]\]/m.test(text)) return "Checklist";
  if (/case study|사례/.test(text)) return "CaseStudy";
  if (markdown.length < 900) return "KeyPoint";
  return "NormalText";
}
