import { getVercelOidcToken } from "@vercel/oidc";
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

type CodexBridgePayload = {
  value?: unknown;
  usage?: Usage;
  error?: string;
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

function internalOrigin() {
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return host ? `https://${host}` : "https://ai-book-studio-iota.vercel.app";
}

async function generateWithCodexBridge<T>(userId: string, args: StructuredArgs<T>): Promise<{ value: T; usage: Usage }> {
  const oidcToken = process.env.VERCEL_OIDC_TOKEN ?? await getVercelOidcToken({
    project: "ai-book-studio",
    team: "koreassp105-1594s-projects"
  });
  if (!oidcToken) throw new Error("CODEX_INTERNAL_AUTH_UNAVAILABLE");

  const response = await fetch(`${internalOrigin()}/api/books/codex/generate`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${oidcToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      userId,
      schemaName: args.schemaName,
      jsonSchema: args.jsonSchema,
      system: args.system,
      prompt: args.prompt,
      timeoutMs: args.timeoutMs
    }),
    cache: "no-store"
  });
  const payload = await response.json().catch(() => ({ error: `CODEX_INTERNAL_HTTP_${response.status}` })) as CodexBridgePayload;
  if (!response.ok || payload.error) throw new Error(payload.error ?? `CODEX_INTERNAL_HTTP_${response.status}`);
  if (!payload.usage) throw new Error("CODEX_INTERNAL_INVALID_RESPONSE");
  return { value: args.parse(payload.value), usage: payload.usage };
}

export async function generateBackgroundStructured<T>(
  provider: BackgroundAiProvider,
  userId: string,
  args: StructuredArgs<T>
): Promise<{ value: T; usage: Usage }> {
  if (provider === "codex") return generateWithCodexBridge(userId, args);
  const key = await loadOpenRouterKey(userId);
  if (!key) throw new Error("FREE_AI_CONNECTION_REQUIRED");
  const client = new OpenRouterFreeProvider(key);
  return client.generateStructured({ model: "openrouter/free", ...args });
}
