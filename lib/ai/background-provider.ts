import { OpenRouterFreeProvider } from "@/lib/ai/openrouter-free";
import { createServiceSupabase } from "@/lib/supabase/server";

export type BackgroundAiProvider = "openrouter" | "codex";

type StructuredArgs<T> = {
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  system: string;
  prompt: string;
  parse: (value: unknown) => T;
  timeoutMs?: number;
};

type Usage = {
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  model: string;
  requestId?: string;
};

export function normalizeBackgroundProvider(value: unknown): BackgroundAiProvider {
  return value === "codex" ? "codex" : "openrouter";
}

export function backgroundProviderLabel(provider: BackgroundAiProvider) {
  return provider === "codex" ? "GPT-5.6 Luna · ChatGPT Plus" : "OpenRouter Free";
}

export function backgroundProviderCheckpointPrefix(provider: BackgroundAiProvider) {
  return provider === "codex" ? "CODEX_LUNA" : "FREE";
}

async function loadOpenRouterKey(userId: string) {
  const service = createServiceSupabase();
  const { data, error } = await service.rpc<string | null>("get_openrouter_credential", { p_user_id: userId });
  if (error) throw new Error(error.message);
  return typeof data === "string" && data.trim().length > 0 ? data : null;
}

export async function hasBackgroundCredential(userId: string, provider: BackgroundAiProvider) {
  if (provider === "codex") {
    const { hasCodexWorkerConnection } = await import("@/lib/ai/codex-worker");
    return hasCodexWorkerConnection(userId);
  }
  const service = createServiceSupabase();
  const { data, error } = await service.rpc<boolean>("has_openrouter_credential", { p_user_id: userId });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function generateBackgroundStructured<T>(
  provider: BackgroundAiProvider,
  userId: string,
  args: StructuredArgs<T>
): Promise<{ value: T; usage: Usage }> {
  if (provider === "codex") {
    const { generateCodexWorkerStructured } = await import("@/lib/ai/codex-worker");
    return generateCodexWorkerStructured(userId, args);
  }
  const key = await loadOpenRouterKey(userId);
  if (!key) throw new Error("FREE_AI_CONNECTION_REQUIRED");
  const client = new OpenRouterFreeProvider(key);
  return client.generateStructured({ model: "openrouter/free", ...args });
}
