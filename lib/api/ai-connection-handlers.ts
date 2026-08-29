import { NextResponse } from "next/server";
import { createServiceSupabase, requireUser } from "@/lib/supabase/server";
import {
  CODEX_LUNA_MODEL,
  callCodexWorker,
  codexWorkerConfigured,
  readCodexWorkerStatus,
  type CodexWorkerStatus
} from "@/lib/ai/codex-worker";

function wantsCodex(request: Request) {
  return new URL(request.url).searchParams.get("provider") === "codex";
}

async function syncCodexProfile(userId: string, status: CodexWorkerStatus) {
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

function codexPayload(status: CodexWorkerStatus) {
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

export async function handleAiConnectionGET(request: Request) {
  try {
    const { user } = await requireUser();
    if (wantsCodex(request)) {
      if (!codexWorkerConfigured()) {
        return NextResponse.json({
          connected: false,
          backgroundReady: false,
          workerConfigured: false,
          provider: "codex_chatgpt",
          model: CODEX_LUNA_MODEL,
          modelAvailable: null,
          planType: null,
          rateLimits: null,
          error: "CODEX_WORKER_UNAVAILABLE"
        });
      }
      const status = await readCodexWorkerStatus(user.id);
      await syncCodexProfile(user.id, status);
      return NextResponse.json(codexPayload(status));
    }

    const service = createServiceSupabase();
    const { data, error } = await service.rpc<boolean>("has_openrouter_credential", { p_user_id: user.id });
    if (error) throw new Error(error.message);
    return NextResponse.json({ connected: data === true, backgroundReady: data === true, provider: "openrouter" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI_CONNECTION_STATUS_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

export async function handleAiConnectionDELETE(request: Request) {
  try {
    const { user } = await requireUser();
    const service = createServiceSupabase();
    if (wantsCodex(request)) {
      if (!codexWorkerConfigured()) throw new Error("CODEX_WORKER_UNAVAILABLE");
      await callCodexWorker("/auth/logout", { method: "POST", body: { userId: user.id } });
      const { error } = await service.from("codex_connection_profiles").delete().eq("user_id", user.id);
      if (error) throw new Error(error.message);
      return NextResponse.json({ connected: false });
    }

    const { error } = await service.rpc("delete_openrouter_credential", { p_user_id: user.id });
    if (error) throw new Error(error.message);
    return NextResponse.json({ connected: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI_DISCONNECT_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "CODEX_WORKER_UNAVAILABLE" ? 503 : 400 });
  }
}

export async function handleAiConnectionPOST(request: Request) {
  if (!wantsCodex(request)) return NextResponse.json({ error: "METHOD_NOT_SUPPORTED" }, { status: 405 });

  try {
    const { user } = await requireUser();
    if (!codexWorkerConfigured()) throw new Error("CODEX_WORKER_UNAVAILABLE");
    const result = await callCodexWorker<{
      type: "chatgptDeviceCode" | "already_connected";
      loginId?: string;
      verificationUrl?: string;
      userCode?: string;
      connected?: boolean;
      authMode?: string | null;
      email?: string | null;
      planType?: string | null;
      modelAvailable?: boolean;
      models?: string[];
      rateLimits?: unknown;
    }>("/auth/start", { method: "POST", body: { userId: user.id }, timeoutMs: 60000 });

    if (result.type === "already_connected") {
      const status: CodexWorkerStatus = {
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
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : message === "CODEX_WORKER_UNAVAILABLE" ? 503 : 400 });
  }
}
