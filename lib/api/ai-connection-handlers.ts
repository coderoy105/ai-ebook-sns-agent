import { NextResponse } from "next/server";
import { createServiceSupabase, requireUser } from "@/lib/supabase/server";
import type { CodexAppServerClient } from "@/lib/ai/codex-runtime";

function wantsCodex(request: Request) {
  return new URL(request.url).searchParams.get("provider") === "codex";
}

export async function handleAiConnectionGET(request: Request) {
  try {
    const { user } = await requireUser();
    const service = createServiceSupabase();
    if (wantsCodex(request)) {
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
    }

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
    const fn = wantsCodex(request) ? "delete_codex_chatgpt_credential" : "delete_openrouter_credential";
    const { error } = await service.rpc(fn, { p_user_id: user.id });
    if (error) throw new Error(error.message);
    return NextResponse.json({ connected: false });
  } catch (error) {
    const message = error instanceof Error ? error.message : "AI_DISCONNECT_FAILED";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}

export async function handleAiConnectionPOST(request: Request) {
  if (!wantsCodex(request)) return NextResponse.json({ error: "METHOD_NOT_SUPPORTED" }, { status: 405 });

  let user: { id: string };
  try {
    ({ user } = await requireUser());
  } catch (error) {
    const message = error instanceof Error ? error.message : "UNAUTHORIZED";
    return NextResponse.json({ error: message }, { status: 401 });
  }

  const encoder = new TextEncoder();
  let client: CodexAppServerClient | null = null;
  let cleanup: (() => Promise<void>) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: unknown) => {
        try { controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`)); }
        catch { /* browser may have disconnected */ }
      };

      const run = async () => {
        try {
          send({ type: "starting", message: "Codex ChatGPT 로그인을 준비하고 있습니다." });
          const { createEphemeralCodexHome, CodexAppServerClient, inspectCodexAccount } = await import("@/lib/ai/codex-runtime");
          const runtimeHome = await createEphemeralCodexHome();
          cleanup = runtimeHome.cleanup;
          client = await CodexAppServerClient.start(runtimeHome.dir);

          const login = await client.request("account/login/start", { type: "chatgptDeviceCode" }, 60000) as {
            type?: string;
            loginId?: string;
            verificationUrl?: string;
            userCode?: string;
          } | null;
          if (!login?.loginId || !login.verificationUrl || !login.userCode) throw new Error("CODEX_DEVICE_CODE_START_FAILED");

          send({
            type: "device_code",
            loginId: login.loginId,
            verificationUrl: login.verificationUrl,
            userCode: login.userCode,
            expiresInSeconds: 240
          });

          const completed = await client.waitForNotification(
            "account/login/completed",
            (params) => (params as { loginId?: string } | null)?.loginId === login.loginId,
            240000
          ) as { success?: boolean; error?: string | null } | null;
          if (!completed?.success) throw new Error(completed?.error || "CODEX_LOGIN_FAILED");

          await new Promise((resolve) => setTimeout(resolve, 250));
          const snapshot = await inspectCodexAccount(client);
          const authJson = await runtimeHome.readAuthJson();
          if (!authJson.trim()) throw new Error("CODEX_AUTH_NOT_PERSISTED");

          const service = createServiceSupabase();
          const { error: saveError } = await service.rpc("store_codex_chatgpt_credential", {
            p_user_id: user.id,
            p_auth_json: authJson,
            p_email: snapshot.email,
            p_plan_type: snapshot.planType,
            p_model_available: snapshot.modelAvailable,
            p_rate_limits: snapshot.rateLimits
          });
          if (saveError) throw new Error(saveError.message);

          send({
            type: "connected",
            authMode: snapshot.authMode,
            email: snapshot.email,
            planType: snapshot.planType,
            model: "gpt-5.6-luna",
            modelAvailable: snapshot.modelAvailable,
            rateLimits: snapshot.rateLimits
          });
        } catch (error) {
          send({ type: "error", error: error instanceof Error ? error.message : "CODEX_LOGIN_FAILED" });
        } finally {
          try { await client?.stop(); } catch { /* no-op */ }
          try { await cleanup?.(); } catch { /* no-op */ }
          try { controller.close(); } catch { /* no-op */ }
        }
      };

      request.signal.addEventListener("abort", () => { void client?.stop(); }, { once: true });
      void run();
    },
    cancel() {
      void client?.stop();
      void cleanup?.();
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no"
    }
  });
}
