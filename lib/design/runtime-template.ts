import { builtInTemplates, type DesignDNA } from "./templates";

export type CustomTemplateDesign = {
  baseTemplateId: string;
  accentColor: string;
  paperTone: string;
  headingFamily: "serif" | "sans";
  bodyFamily: "serif" | "sans";
  spacingScale: "tight" | "balanced" | "airy";
  contentWidth: "narrow" | "medium" | "wide";
  chapterStyle: "classic" | "bold" | "minimal";
  quoteStyle: "line" | "box" | "indent";
};

export type RuntimeDesign = CustomTemplateDesign & {
  id: string;
  name: string;
  dna: DesignDNA;
  isCustom: boolean;
};

export type TemplateDbRow = {
  id: string;
  name: string;
  genre?: string | null;
  design_dna?: unknown;
  is_system?: boolean | null;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? value as T : fallback;
}

function safeColor(value: unknown, fallback: string) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/iu.test(value) ? value : fallback;
}

function defaultAccent(templateId: string) {
  if (templateId === "minimal-tech") return "#2447d8";
  if (templateId === "quiet-fiction") return "#9c8560";
  return "#8a5b4b";
}

function defaultPaper(templateId: string) {
  return templateId === "quiet-fiction" ? "#f8f6f1" : "#fffef9";
}

export function resolveRuntimeDesign(templateId: string | null | undefined, row?: TemplateDbRow | null): RuntimeDesign {
  const raw = record(row?.design_dna);
  const requestedBase = typeof raw.baseTemplateId === "string" ? raw.baseTemplateId : row?.is_system ? row.id : templateId;
  const dna = builtInTemplates.find((item) => item.id === requestedBase) ?? builtInTemplates.find((item) => item.id === templateId) ?? builtInTemplates[0];
  const isCustom = Boolean(row && row.is_system === false);
  const defaultHeading: "serif" | "sans" = dna.id === "minimal-tech" ? "sans" : "serif";
  const defaultBody: "serif" | "sans" = dna.id === "minimal-tech" ? "sans" : "serif";

  return {
    id: row?.id ?? dna.id,
    name: row?.name ?? dna.name,
    dna,
    isCustom,
    baseTemplateId: dna.id,
    accentColor: safeColor(raw.accentColor, defaultAccent(dna.id)),
    paperTone: safeColor(raw.paperTone, defaultPaper(dna.id)),
    headingFamily: enumValue(raw.headingFamily, ["serif", "sans"] as const, defaultHeading),
    bodyFamily: enumValue(raw.bodyFamily, ["serif", "sans"] as const, defaultBody),
    spacingScale: enumValue(raw.spacingScale, ["tight", "balanced", "airy"] as const, dna.spacingScale),
    contentWidth: enumValue(raw.contentWidth, ["narrow", "medium", "wide"] as const, dna.contentWidth),
    chapterStyle: enumValue(raw.chapterStyle, ["classic", "bold", "minimal"] as const, dna.id === "quiet-fiction" ? "classic" : dna.id === "minimal-tech" ? "minimal" : "bold"),
    quoteStyle: enumValue(raw.quoteStyle, ["line", "box", "indent"] as const, dna.id === "minimal-tech" ? "box" : dna.id === "quiet-fiction" ? "indent" : "line")
  };
}

export function runtimeDesignSnapshot(design: RuntimeDesign) {
  return {
    id: design.id,
    name: design.name,
    baseTemplateId: design.baseTemplateId,
    accentColor: design.accentColor,
    paperTone: design.paperTone,
    headingFamily: design.headingFamily,
    bodyFamily: design.bodyFamily,
    spacingScale: design.spacingScale,
    contentWidth: design.contentWidth,
    chapterStyle: design.chapterStyle,
    quoteStyle: design.quoteStyle,
    isCustom: design.isCustom
  };
}
