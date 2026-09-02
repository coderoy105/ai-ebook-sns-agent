import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { registerBookAutopilot } from "@/lib/jobs/register-book-autopilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: bookId } = await context.params;
    const { user } = await requireUser();
    const result = await registerBookAutopilot(bookId, user.id);
    return response(result, result.reused ? 200 : 202);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AUTOPILOT_REGISTRATION_FAILED";
    return response({ error: message }, message === "UNAUTHORIZED" ? 401 : message === "BOOK_NOT_FOUND" ? 404 : 400);
  }
}
