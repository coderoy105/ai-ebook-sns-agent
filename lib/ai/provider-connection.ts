import { createServiceSupabase } from "@/lib/supabase/server";
import { readCodexRuntimeStatus } from "@/lib/ai/codex-runtime-client";
import { isTransientCodexError } from "@/lib/ai/transient-codex-errors";
import type { BackgroundAiProvider } from "@/lib/ai/background-provider";

export async function hasBackgroundCredential(userId: string, provider: BackgroundAiProvider) {
  if (provider === "codex") {
    try {
      const status = await readCodexRuntimeStatus(userId);
      return status.connected && status.authMode === "chatgpt" && status.modelAvailable;
    } catch (error) {
      if (!isTransientCodexError(error)) return false;
      // A runtime/Sandbox timeout does not prove that the persisted ChatGPT
      // authorization disappeared. Fall back to the last successfully verified
      // profile; the real generation request will surface an explicit
      // CODEX_CONNECTION_REQUIRED/EXPIRED if authorization is actually gone.
      const service = createServiceSupabase();
      const { data } = await service.from("codex_connection_profiles")
        .select("model_available")
        .eq("user_id", userId)
        .maybeSingle();
      return data?.model_available === true;
    }
  }
  const service = createServiceSupabase();
  const { data, error } = await service.rpc<boolean>("has_openrouter_credential", { p_user_id: userId });
  if (error) throw new Error(error.message);
  return data === true;
}
