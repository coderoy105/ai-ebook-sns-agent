import { NextResponse } from "next/server";
import { createServiceSupabase, requireUser } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { user } = await requireUser();
    const service = createServiceSupabase();
    const { data: connected, error } = await service.rpc<boolean>("has_codex_chatgpt_credential", { p_user_id: user.id });
    if (error) throw new Error(error.message);

    const { data: profile } = await service.from("codex_connection_profiles")
      .select("email,plan_type,selected_model,model_available,rate_limits,updated_at")
      .eq("user_id", user.id)
      .maybeSingle();

    return NextResponse.json({
      connected: connected === true,
      backgroundReady: connected === true && profile?.model_available !== false,
      provider: "codex_chatgpt",
      model: profile?.selected_model ?? "gpt-5.6-luna",
      modelAvailable: profile?.model_available ?? null,
      planType: profile?.plan_type ?? null,
      email: profile?.email ?? null,
      rateLimits: profile?.rate_limits ?? null,
      updatedAt: profile?.updated_at ?? null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CODEX_CONNECTION_STATUS_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

export async function DELETE() {
  try {
    const { user } = await requireUser();
    const service = createServiceSupabase();
    const { error } = await service.rpc("delete_codex_chatgpt_credential", { p_user_id: user.id });
    if (error) throw new Error(error.message);
    return NextResponse.json({ connected: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CODEX_DISCONNECT_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
