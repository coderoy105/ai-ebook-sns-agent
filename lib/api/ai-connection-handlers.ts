import { NextResponse } from "next/server";
import { createServiceSupabase, requireUser } from "@/lib/supabase/server";
import { CODEX_LUNA_MODEL } from "@/lib/ai/codex-constants";
import {
  logoutCodexRuntime,
  readCodexRuntimeStatus,
  startCodexRuntimeLogin,
  type CodexRuntimeStatus
} from "@/lib/ai/codex-runtime-client";

function wantsCodex(request: Request) {
  return new URL(request.url).searchParams.get("provider") === "codex";
}

async function syncCodexProfile(userId: string, status: CodexRuntimeStatus) {
  const service = createServiceSupabase();
  if (!status.connected) {
    await service.from("codex_connection_profiles").delete().eq("user_id", userId);
    return;
  }
  const { error } = await service.from("codex_connection_profiles").upsert({
    user_id: userId,
    email: status.email,
    plan_type: status.planType,
    selected_model: CODEX_LUNA_MODEL,
    model_available: status.modelAvailable,
    rate_limits: status.rateLimits ?? {},
    updated_at: new Date().toISOString()
  }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
}

function codexPayload(status: CodexRuntimeStatus) {
  return {
    connected: status.connected,
    backgroundReady: status.connected && status.authMode === "chatgpt" && status.modelAvailable,
    workerConfigured: true,
    provider: "codex_chatgpt",
    authMode: status.authMode,
    model: CODEX_LUNA_MODEL,
    modelAvailable: status.modelAvailable,
    models: status.models,
    planType: status.planType,
    email: status.email,
    rateLimits: status.rateLimits
  };
}

function errorStatus(message: string) {
  if (message === "UNAUTHORIZED") return 401;
  if (message === "CODEX_RUNTIME_UNAVAILABLE" || message === "CODEX_INTERNAL_AUTH_UNAVAILABLE" || message === "CODEX_WORKER_UNAVAILABLE") return 503;
  return 400;
}

export async function handleAiConnectionGET(request: Request) {
  try {
    const { user } = await requireUser();
    if (wantsCodex(request)) {
      const status = await readCodexRuntimeStatus(user.id);
      await syncCodexProfile(user.id, status);
      return NextResponse.json(codexPayload(status));
    }

    const service = createServiceSupabase();
    const { data, error } = await service.rpc<boolean>("has_openrouter_credential", { p_user_id: user.id });
    if (error) throw new Error(error.message);
    return NextResponse.json({ connected: data === true, backgroundReady: data === true, provider: "openrouter" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI_CONNECTION_STATUS_FAILED";
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}

export async function handleAiConnectionDELETE(request: Request) {
  try {
    const { user } = await requireUser();
    const service = createServiceSupabase();
    if (wantsCodex(request)) {
      await logoutCodexRuntime(user.id);
      const { error } = await service.from("codex_connection_profiles").delete().eq("user_id", user.id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ connected: false });
    }

    const { error } = await service.rpc("delete_openrouter_credential", { p_user_id: user.id });
    if (error) throw new Error(error.message);
    return NextResponse.json({ connected: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI_DISCONNECT_FAILED";
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}

export async function handleAiConnectionPOST(request: Request) {
  if (!wantsCodex(request)) return NextResponse.json({ error: "METHOD_NOT_SUPPORTED" }, { status: 405 });

  try {
    const { user } = await requireUser();
    const result = await startCodexRuntimeLogin(user.id);

    if (result.type === "already_connected") {
      const status: CodexRuntimeStatus = {
        connected: result.connected === true,
        authMode: result.authMode ?? null,
        email: result.email ?? null,
        planType: result.planType ?? null,
        model: CODEX_LUNA_MODEL,
        modelAvailable: result.modelAvailable === true,
        models: result.models ?? [],
        rateLimits: result.rateLimits ?? null
      };
      await syncCodexProfile(user.id, status);
      return NextResponse.json({ type: "connected", ...codexPayload(status) });
    }

    if (!result.loginId || !result.verificationUrl || !result.userCode) throw new Error("CODEX_DEVICE_CODE_START_FAILED");
    return NextResponse.json({
      type: "device_code",
      loginId: result.loginId,
      verificationUrl: result.verificationUrl,
      userCode: result.userCode
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CODEX_LOGIN_FAILED";
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}
