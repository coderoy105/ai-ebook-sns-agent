import { createServiceSupabase } from "@/lib/supabase/server";
import { readCodexRuntimeStatus } from "@/lib/ai/codex-runtime-client";
import type { BackgroundAiProvider } from "@/lib/ai/background-provider";

export async function hasBackgroundCredential(userId: string, provider: BackgroundAiProvider) {
  if (provider === "codex") {
    try {
      const status = await readCodexRuntimeStatus(userId);
      return status.connected && status.authMode === "chatgpt" && status.modelAvailable;
    } catch {
      return false;
    }
  }
  const service = createServiceSupabase();
  const { data, error } = await service.rpc<boolean>("has_openrouter_credential", { p_user_id: userId });
  if (error) throw new Error(error.message);
  return data === true;
}
