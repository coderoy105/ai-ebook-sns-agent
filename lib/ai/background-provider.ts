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

type CodexBridgeResponse = {
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

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function internalBaseUrl() {
  const deployment = process.env.VERCEL_URL?.trim();
  if (deployment) return `https://${deployment}`;
  const production = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (production) return `https://${production}`;
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (configured) return configured;
  return "http://localhost:3000";
}

async function createCodexTicket(userId: string) {
  const raw = `${crypto.randomUUID()}.${crypto.randomUUID()}`;
  const ticketHash = await sha256(raw);
  const service = createServiceSupabase();
  const { error } = await service.from("codex_internal_tickets").insert({
    ticket_hash: ticketHash,
    user_id: userId,
    expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString()
  });
  if (error) throw new Error(`CODEX_INTERNAL_TICKET_FAILED: ${error.message}`);
  return raw;
}

async function generateCodexThroughInternalApi<T>(userId: string, args: StructuredArgs<T>) {
  const ticket = await createCodexTicket(userId);
  const controller = new AbortController();
  const timeoutMs = Math.min(Math.max(Number(args.timeoutMs ?? 220_000) + 15_000, 30_000), 285_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${internalBaseUrl()}/api/core/internal/codex/generate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ai-book-codex-ticket": ticket
      },
      body: JSON.stringify({
        schemaName: args.schemaName,
        jsonSchema: args.jsonSchema,
        system: args.system,
        prompt: args.prompt,
        timeoutMs: args.timeoutMs
      }),
      cache: "no-store",
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({ error: `CODEX_INTERNAL_HTTP_${response.status}` })) as CodexBridgeResponse;
    if (!response.ok || payload.error) throw new Error(payload.error ?? `CODEX_INTERNAL_HTTP_${response.status}`);
    if (!payload.usage) throw new Error("CODEX_INTERNAL_USAGE_MISSING");
    return { value: args.parse(payload.value), usage: payload.usage };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("CODEX_GENERATION_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function hasBackgroundCredential(userId: string, provider: BackgroundAiProvider) {
  const service = createServiceSupabase();
  if (provider === "codex") {
    const { data, error } = await service.rpc<boolean>("has_codex_chatgpt_credential", { p_user_id: userId });
    if (error) throw new Error(error.message);
    return data === true;
  }
  const { data, error } = await service.rpc<boolean>("has_openrouter_credential", { p_user_id: userId });
  if (error) throw new Error(error.message);
  return data === true;
}

export async function generateBackgroundStructured<T>(
  provider: BackgroundAiProvider,
  userId: string,
  args: StructuredArgs<T>
): Promise<{ value: T; usage: Usage }> {
  if (provider === "codex") return generateCodexThroughInternalApi(userId, args);
  const key = await loadOpenRouterKey(userId);
  if (!key) throw new Error("FREE_AI_CONNECTION_REQUIRED");
  const client = new OpenRouterFreeProvider(key);
  return client.generateStructured({ model: "openrouter/free", ...args });
}
