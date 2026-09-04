import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase, requireUser } from "@/lib/supabase/server";
import { builtInTemplates } from "@/lib/design/templates";

export const dynamic = "force-dynamic";

const DesignInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600).default(""),
  baseTemplateId: z.enum(["modern-editorial", "minimal-tech", "quiet-fiction"]),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  paperTone: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  headingFamily: z.enum(["serif", "sans"]),
  bodyFamily: z.enum(["serif", "sans"]),
  spacingScale: z.enum(["tight", "balanced", "airy"]),
  contentWidth: z.enum(["narrow", "medium", "wide"]),
  chapterStyle: z.enum(["classic", "bold", "minimal"]),
  quoteStyle: z.enum(["line", "box", "indent"])
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function serialize(row: Record<string, unknown>) {
  const dna = asRecord(row.design_dna);
  const id = typeof row.id === "string" ? row.id : "";
  const name = typeof row.name === "string" ? row.name : "Untitled Template";
  const createdAt = typeof row.created_at === "string" ? row.created_at : null;
  return {
    id,
    name,
    description: typeof dna.description === "string" ? dna.description : "",
    baseTemplateId: typeof dna.baseTemplateId === "string" ? dna.baseTemplateId : "modern-editorial",
    accentColor: typeof dna.accentColor === "string" ? dna.accentColor : "#2447d8",
    paperTone: typeof dna.paperTone === "string" ? dna.paperTone : "#fffef9",
    headingFamily: dna.headingFamily === "sans" ? "sans" : "serif",
    bodyFamily: dna.bodyFamily === "sans" ? "sans" : "serif",
    spacingScale: ["tight", "balanced", "airy"].includes(String(dna.spacingScale)) ? String(dna.spacingScale) : "balanced",
    contentWidth: ["narrow", "medium", "wide"].includes(String(dna.contentWidth)) ? String(dna.contentWidth) : "medium",
    chapterStyle: ["classic", "bold", "minimal"].includes(String(dna.chapterStyle)) ? String(dna.chapterStyle) : "bold",
    quoteStyle: ["line", "box", "indent"].includes(String(dna.quoteStyle)) ? String(dna.quoteStyle) : "line",
    createdAt,
    isSystem: false
  };
}

export async function GET() {
  try {
    const { user } = await requireUser();
    const service = createServiceSupabase();
    const { data, error } = await service.from("templates")
      .select("id,name,design_dna,created_at,is_system")
      .eq("is_system", false)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    const templates = (data ?? []).filter((row) => asRecord(row.design_dna).ownerUserId === user.id).map((row) => serialize(row));
    return NextResponse.json({ templates }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "TEMPLATE_LIST_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    const input = DesignInputSchema.parse(await request.json());
    const base = builtInTemplates.find((item) => item.id === input.baseTemplateId) ?? builtInTemplates[0];
    const id = `custom-${crypto.randomUUID()}`;
    const designDna = {
      ownerUserId: user.id,
      description: input.description,
      baseTemplateId: input.baseTemplateId,
      accentColor: input.accentColor.toLowerCase(),
      paperTone: input.paperTone.toLowerCase(),
      headingFamily: input.headingFamily,
      bodyFamily: input.bodyFamily,
      spacingScale: input.spacingScale,
      contentWidth: input.contentWidth,
      chapterStyle: input.chapterStyle,
      quoteStyle: input.quoteStyle,
      mood: base.mood
    };
    const service = createServiceSupabase();
    const { data, error } = await service.from("templates").insert({
      id,
      name: input.name,
      genre: "custom",
      design_dna: designDna,
      is_system: false
    }).select("id,name,design_dna,created_at").single();
    if (error || !data) throw error ?? new Error("TEMPLATE_SAVE_FAILED");
    return NextResponse.json({ template: serialize(data) }, { status: 201, headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "TEMPLATE_SAVE_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
