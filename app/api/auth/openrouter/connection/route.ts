import { NextResponse } from "next/server";
import { createServiceSupabase, requireUser } from "@/lib/supabase/server";

export async function GET() {
  try {
    const { user } = await requireUser();
    const service = createServiceSupabase();
    const { data, error } = await service.rpc<boolean>("has_openrouter_credential", { p_user_id: user.id });
    if (error) throw new Error(error.message);
    return NextResponse.json({ connected: data === true, backgroundReady: data === true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "FREE_AI_CONNECTION_STATUS_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

export async function DELETE() {
  try {
    const { user } = await requireUser();
    const service = createServiceSupabase();
    const { error } = await service.rpc("delete_openrouter_credential", { p_user_id: user.id });
    if (error) throw new Error(error.message);
    return NextResponse.json({ connected: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "FREE_AI_DISCONNECT_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
