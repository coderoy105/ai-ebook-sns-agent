import { createServiceSupabase } from "@/lib/supabase/server";
import { hasCodexWorkerConnection } from "@/lib/ai/codex-worker";
import type { BackgroundAiProvider } from "@/lib/ai/background-provider";

export async function hasBackgroundCredential(userId: string, provider: BackgroundAiProvider) {
  if (provider === "codex") return hasCodexWorkerConnection(userId);
  const service = createServiceSupabase();
  const { data, error } = await service.rpc<boolean>("has_openrouter_credential", { p_user_id: userId });
  if (error) throw new Error(error.message);
  return data === true;
}
