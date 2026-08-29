import { OpenRouterFreeProvider } from "@/lib/ai/openrouter-free";
import { CodexPlusProvider } from "@/lib/ai/codex-plus";
import { createServiceSupabase } from "@/lib/supabase/server";

export type BackgroundAiProvider = "openrouter" | "codex";

type StructuredArgs<T> = {
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  system: string;
  prompt: string;
  parse: (value: unknown) => T;
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
  const service = createServiceSupabase();
  const fn = provider === "codex" ? "has_codex_chatgpt_credential" : "has_openrouter_credential";
  const { data, error } = await service.rpc<boolean>(fn, { p_user_id: userId });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function generateBackgroundStructured<T>(
  provider: BackgroundAiProvider,
  userId: string,
  args: StructuredArgs<T>
) {
  if (provider === "codex") {
    return new CodexPlusProvider(userId).generateStructured(args);
  }
  const key = await loadOpenRouterKey(userId);
  if (!key) throw new Error("FREE_AI_CONNECTION_REQUIRED");
  const client = new OpenRouterFreeProvider(key);
  return client.generateStructured({ model: "openrouter/free", ...args });
}
