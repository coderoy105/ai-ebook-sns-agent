import { createServiceSupabase, requireUser } from "@/lib/supabase/server";
import {
  CodexAppServerClient,
  createEphemeralCodexHome,
  inspectCodexAccount
} from "@/lib/ai/codex-runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(request: Request) {
  const { user } = await requireUser();
  const encoder = new TextEncoder();
  let client: CodexAppServerClient | null = null;
  let cleanup: (() => Promise<void>) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (payload: unknown) => {
        try { controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`)); }
        catch { /* client may have disconnected */ }
      };

      const run = async () => {
        try {
          send({ type: "starting", message: "Codex ChatGPT 로그인을 준비하고 있습니다." });
          const runtimeHome = await createEphemeralCodexHome();
          cleanup = runtimeHome.cleanup;
          client = await CodexAppServerClient.start(runtimeHome.dir);

          const login = await client.request("account/login/start", { type: "chatgptDeviceCode" }, 60000) as {
            type?: string;
            loginId?: string;
            verificationUrl?: string;
            userCode?: string;
          } | null;

          if (!login?.loginId || !login.verificationUrl || !login.userCode) {
            throw new Error("CODEX_DEVICE_CODE_START_FAILED");
          }

          send({
            type: "device_code",
            loginId: login.loginId,
            verificationUrl: login.verificationUrl,
            userCode: login.userCode,
            expiresInSeconds: 240
          });

          const completed = await client.waitForNotification(
            "account/login/completed",
            (params) => {
              const value = params as { loginId?: string } | null;
              return value?.loginId === login.loginId;
            },
            240000
          ) as { success?: boolean; error?: string | null } | null;

          if (!completed?.success) {
            throw new Error(completed?.error || "CODEX_LOGIN_FAILED");
          }

          await sleep(250);
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
          const message = error instanceof Error ? error.message : "CODEX_LOGIN_FAILED";
          send({ type: "error", error: message });
        } finally {
          try { await client?.stop(); } catch { /* no-op */ }
          try { await cleanup?.(); } catch { /* no-op */ }
          try { controller.close(); } catch { /* no-op */ }
        }
      };

      request.signal.addEventListener("abort", () => {
        void client?.stop();
      }, { once: true });
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
