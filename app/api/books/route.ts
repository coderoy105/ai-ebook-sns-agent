import { NextResponse } from "next/server";
import { POST as corePost } from "@/app/api/core/[...path]/route";
import { requireUser } from "@/lib/supabase/server";
import { registerBookAutopilot } from "@/lib/jobs/register-book-autopilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type CreatePayload = Record<string, unknown> & { bookId?: string };

/**
 * Filesystem route for POST /api/books.
 *
 * The legacy core handler still owns book/Blueprint creation. This wrapper adds
 * one critical guarantee before the 202 response reaches the phone: it also
 * registers the durable server Autopilot that waits for Blueprint completion
 * and starts the manuscript workflow. The workspace registration remains a
 * retry fallback, not the primary handoff.
 */
export async function POST(request: Request) {
  const coreResponse = await corePost(request, { params: Promise.resolve({ path: ["books"] }) });
  if (!coreResponse.ok) return coreResponse;

  let payload: CreatePayload;
  try {
    payload = await coreResponse.clone().json() as CreatePayload;
  } catch {
    return coreResponse;
  }

  const bookId = typeof payload.bookId === "string" ? payload.bookId.trim() : "";
  if (!bookId) return coreResponse;

  const headers = new Headers(coreResponse.headers);
  headers.set("cache-control", "no-store");

  try {
    const { user } = await requireUser();
    const autopilot = await registerBookAutopilot(bookId, user.id);
    return NextResponse.json({
      ...payload,
      autopilotRegistered: true,
      autopilotRunId: autopilot.runId ?? null,
      phoneOffSafe: true
    }, { status: coreResponse.status, headers });
  } catch (error) {
    // Blueprint creation is already safely registered. Return it rather than
    // deleting the book; the workspace retries Autopilot registration every 5s.
    return NextResponse.json({
      ...payload,
      autopilotRegistered: false,
      phoneOffSafe: false,
      autopilotRetryRequired: true,
      autopilotError: error instanceof Error ? error.message : "AUTOPILOT_REGISTRATION_FAILED"
    }, { status: coreResponse.status, headers });
  }
}
