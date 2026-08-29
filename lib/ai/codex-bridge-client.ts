import { getVercelOidcToken } from "@vercel/oidc";

const CODEX_BRIDGE_PATH = "/api/core/internal/codex/generate";

type StructuredArgs<T> = {
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  system: string;
  prompt: string;
  parse: (value: unknown) => T;
  timeoutMs?: number;
};

type BridgePayload = {
  value?: unknown;
  usage?: { inputTokens: number; outputTokens: number; durationMs: number; model: string; requestId?: string };
  error?: string;
};

function bridgeOrigin() {
  const hostname = process.env.VERCEL_URL?.trim() || process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (!hostname) throw new Error("CODEX_INTERNAL_BRIDGE_UNAVAILABLE");
  return hostname.startsWith("http://") || hostname.startsWith("https://") ? hostname.replace(/\/$/, "") : `https://${hostname}`;
}

export async function generateCodexBridgeStructured<T>(userId: string, args: StructuredArgs<T>) {
  const token = await getVercelOidcToken();
  if (!token) throw new Error("CODEX_INTERNAL_AUTH_UNAVAILABLE");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 240000);
  try {
    const response = await fetch(`${bridgeOrigin()}${CODEX_BRIDGE_PATH}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ userId, schemaName: args.schemaName, jsonSchema: args.jsonSchema, system: args.system, prompt: args.prompt, timeoutMs: args.timeoutMs }),
      cache: "no-store",
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({ error: `CODEX_INTERNAL_HTTP_${response.status}` })) as BridgePayload;
    if (!response.ok || payload.error || !payload.usage) throw new Error(payload.error ?? `CODEX_INTERNAL_HTTP_${response.status}`);
    return { value: args.parse(payload.value), usage: payload.usage };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("CODEX_WORKER_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
