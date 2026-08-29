import { getVercelOidcToken } from "@vercel/oidc";
import { CODEX_LUNA_MODEL } from "@/lib/ai/codex-constants";

export type CodexRuntimeStatus = {
  connected: boolean;
  authMode: string | null;
  email: string | null;
  planType: string | null;
  model: string;
  modelAvailable: boolean;
  models: string[];
  rateLimits: unknown;
};

type RuntimePayload = { error?: string } & Record<string, unknown>;

function runtimeOrigin() {
  const hostname = process.env.VERCEL_URL?.trim() || process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (!hostname) throw new Error("CODEX_RUNTIME_UNAVAILABLE");
  return hostname.startsWith("http://") || hostname.startsWith("https://") ? hostname.replace(/\/$/, "") : `https://${hostname}`;
}

export async function callCodexRuntime<T extends RuntimePayload>(action: string, body: Record<string, unknown>, timeoutMs = 60000): Promise<T> {
  const token = await getVercelOidcToken();
  if (!token) throw new Error("CODEX_INTERNAL_AUTH_UNAVAILABLE");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${runtimeOrigin()}/api/codex-runtime/${encodeURIComponent(action)}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({ error: `CODEX_RUNTIME_HTTP_${response.status}` })) as T;
    if (!response.ok || payload.error) throw new Error(payload.error ?? `CODEX_RUNTIME_HTTP_${response.status}`);
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("CODEX_WORKER_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readCodexRuntimeStatus(userId: string) {
  return callCodexRuntime<CodexRuntimeStatus & RuntimePayload>("status", { userId }, 60000);
}

export async function startCodexRuntimeLogin(userId: string) {
  return callCodexRuntime<RuntimePayload & {
    type: "chatgptDeviceCode" | "already_connected";
    loginId?: string;
    verificationUrl?: string;
    userCode?: string;
    connected?: boolean;
    authMode?: string | null;
    email?: string | null;
    planType?: string | null;
    modelAvailable?: boolean;
    models?: string[];
    rateLimits?: unknown;
  }>("start", { userId }, 90000);
}

export async function logoutCodexRuntime(userId: string) {
  return callCodexRuntime<RuntimePayload & { connected?: boolean }>("logout", { userId }, 60000);
}

export async function generateCodexRuntimeStructured<T>(userId: string, args: {
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  system: string;
  prompt: string;
  timeoutMs?: number;
  parse: (value: unknown) => T;
}) {
  const result = await callCodexRuntime<RuntimePayload & {
    value: unknown;
    usage: { inputTokens: number; outputTokens: number; durationMs: number; model: string; requestId?: string };
  }>("generate", {
    userId,
    model: CODEX_LUNA_MODEL,
    schemaName: args.schemaName,
    jsonSchema: args.jsonSchema,
    system: args.system,
    prompt: args.prompt,
    timeoutMs: args.timeoutMs
  }, Math.min((args.timeoutMs ?? 240000) + 20000, 300000));
  return { value: args.parse(result.value), usage: result.usage };
}
