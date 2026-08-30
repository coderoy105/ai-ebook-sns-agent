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
  // Vercel Workflow also imports this module for pure provider helpers.
  // Keep Node/server-only dependencies lazy so they execute only inside a `use step` call.
  const { createServiceSupabase } = await import("@/lib/supabase/server");
  const service = createServiceSupabase();
  const { data, error } = await service.rpc<string | null>("get_openrouter_credential", { p_user_id: userId });
  if (error) throw new Error(error.message);
  return typeof data === "string" && data.trim().length > 0 ? data : null;
}

export async function generateBackgroundStructured<T>(
  provider: BackgroundAiProvider,
  userId: string,
  args: StructuredArgs<T>
): Promise<{ value: T; usage: Usage }> {
  if (provider === "codex") {
    const { generateCodexRuntimeStructured } = await import("@/lib/ai/codex-runtime-client");
    return generateCodexRuntimeStructured(userId, args);
  }

  const key = await loadOpenRouterKey(userId);
  if (!key) throw new Error("FREE_AI_CONNECTION_REQUIRED");
  const { OpenRouterFreeProvider } = await import("@/lib/ai/openrouter-free");
  const client = new OpenRouterFreeProvider(key);
  return client.generateStructured({ model: "openrouter/free", ...args });
}
