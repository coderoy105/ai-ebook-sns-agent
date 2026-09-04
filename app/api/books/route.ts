import { NextResponse } from "next/server";
import { POST as corePost } from "@/app/api/core/[...path]/route";
import { createServiceSupabase, requireUser } from "@/lib/supabase/server";
import { registerBookAutopilot } from "@/lib/jobs/register-book-autopilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type CreatePayload = Record<string, unknown> & { bookId?: string };

function templateOwner(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const owner = (value as Record<string, unknown>).ownerUserId;
  return typeof owner === "string" ? owner : null;
}

async function assertTemplateAccess(templateId: string, userId: string) {
  const service = createServiceSupabase();
  const { data, error } = await service.from("templates").select("id,is_system,design_dna").eq("id", templateId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("TEMPLATE_NOT_FOUND");
  if (data.is_system === true) return;
  if (templateOwner(data.design_dna) !== userId) throw new Error("TEMPLATE_NOT_FOUND");
}

export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
    const clone = request.clone();
    const body = await clone.json().catch(() => ({})) as { templateMood?: unknown };
    const templateId = typeof body.templateMood === "string" ? body.templateMood.trim() : "";
    if (templateId) await assertTemplateAccess(templateId, user.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : "TEMPLATE_NOT_FOUND";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 404, headers: { "cache-control": "no-store" } });
  }

  const coreResponse = await corePost(request, { params: Promise.resolve({ path: ["books"] }) });
  if (!coreResponse.ok) return coreResponse;

  let payload: CreatePayload;
  try { payload = await coreResponse.clone().json() as CreatePayload; }
  catch { return coreResponse; }

  const bookId = typeof payload.bookId === "string" ? payload.bookId.trim() : "";
  if (!bookId) return coreResponse;
  const headers = new Headers(coreResponse.headers);
  headers.set("cache-control", "no-store");

  try {
    const { user } = await requireUser();
    const autopilot = await registerBookAutopilot(bookId, user.id);
    return NextResponse.json({ ...payload, autopilotRegistered: true, autopilotRunId: autopilot.runId ?? null, phoneOffSafe: true }, { status: coreResponse.status, headers });
  } catch (error) {
    return NextResponse.json({ ...payload, autopilotRegistered: false, phoneOffSafe: false, autopilotRetryRequired: true, autopilotError: error instanceof Error ? error.message : "AUTOPILOT_REGISTRATION_FAILED" }, { status: coreResponse.status, headers });
  }
}
