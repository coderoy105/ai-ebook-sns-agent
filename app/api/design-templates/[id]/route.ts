import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase, requireUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(600).optional(),
  baseTemplateId: z.enum(["modern-editorial", "minimal-tech", "quiet-fiction"]).optional(),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  paperTone: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  headingFamily: z.enum(["serif", "sans"]).optional(),
  bodyFamily: z.enum(["serif", "sans"]).optional(),
  spacingScale: z.enum(["tight", "balanced", "airy"]).optional(),
  contentWidth: z.enum(["narrow", "medium", "wide"]).optional(),
  chapterStyle: z.enum(["classic", "bold", "minimal"]).optional(),
  quoteStyle: z.enum(["line", "box", "indent"]).optional()
});

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function ownedTemplate(id: string, userId: string) {
  const service = createServiceSupabase();
  const { data, error } = await service.from("templates").select("id,name,design_dna,is_system").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data || data.is_system || record(data.design_dna).ownerUserId !== userId) return null;
  return data;
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireUser();
    const { id } = await context.params;
    const current = await ownedTemplate(id, user.id);
    if (!current) return NextResponse.json({ error: "TEMPLATE_NOT_FOUND" }, { status: 404 });
    const input = PatchSchema.parse(await request.json());
    const dna = { ...record(current.design_dna), ...input, ownerUserId: user.id };
    delete (dna as Record<string, unknown>).name;
    const service = createServiceSupabase();
    const { error } = await service.from("templates").update({
      ...(input.name ? { name: input.name } : {}),
      design_dna: dna
    }).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "TEMPLATE_UPDATE_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { user } = await requireUser();
    const { id } = await context.params;
    const current = await ownedTemplate(id, user.id);
    if (!current) return NextResponse.json({ error: "TEMPLATE_NOT_FOUND" }, { status: 404 });
    const service = createServiceSupabase();
    const { data: usedSettings, error: settingsError } = await service.from("book_settings").select("book_id").eq("template_id", id).limit(1);
    if (settingsError) throw settingsError;
    if (usedSettings?.length) return NextResponse.json({ error: "TEMPLATE_IN_USE" }, { status: 409 });
    const { data: usedPages, error: usedError } = await service.from("pages").select("id").eq("template_id", id).limit(1);
    if (usedError) throw usedError;
    if (usedPages?.length) return NextResponse.json({ error: "TEMPLATE_IN_USE" }, { status: 409 });
    const { error } = await service.from("templates").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "TEMPLATE_DELETE_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 500 });
  }
}
