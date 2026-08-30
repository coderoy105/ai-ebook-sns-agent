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

type RuntimePayload = { error?: unknown } & Record<string, unknown>;

const DEFAULT_GENERATION_TIMEOUT_MS = 165000;
const MAX_GENERATION_TIMEOUT_MS = 180000;
const RUNTIME_OVERHEAD_BUDGET_MS = 70000;
const MAX_RUNTIME_REQUEST_MS = 270000;

function boundedGenerationTimeout(value: number | undefined) {
  const requested = Number(value ?? DEFAULT_GENERATION_TIMEOUT_MS);
  if (!Number.isFinite(requested)) return DEFAULT_GENERATION_TIMEOUT_MS;
  return Math.min(Math.max(Math.trunc(requested), 30000), MAX_GENERATION_TIMEOUT_MS);
}

function safeErrorDetail(value: unknown, depth = 0): unknown {
  if (depth > 2 || value == null) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      cause: safeErrorDetail(value.cause, depth + 1),
      ...Object.fromEntries(Object.getOwnPropertyNames(value)
        .filter((key) => !["stack", "cause"].includes(key))
        .map((key) => [key, safeErrorDetail((value as unknown as Record<string, unknown>)[key], depth + 1)]))
    };
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(["name", "message", "code", "status", "statusCode", "cause", "error", "details"]
      .filter((key) => key in record)
      .map((key) => [key, safeErrorDetail(record[key], depth + 1)]));
  }
  return String(value);
}

function describeError(value: unknown) {
  if (typeof value === "string") return value.slice(0, 1600);
  try {
    const text = JSON.stringify(safeErrorDetail(value));
    return text && text !== "{}" ? text.slice(0, 1600) : String(value).slice(0, 1600);
  } catch {
    return String(value).slice(0, 1600);
  }
}

function runtimeOrigin() {
  const productionHostname = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const deploymentHostname = process.env.VERCEL_URL?.trim();
  const hostname = process.env.VERCEL_ENV === "production"
    ? (productionHostname || deploymentHostname)
    : (deploymentHostname || productionHostname);
  if (!hostname) throw new Error("CODEX_RUNTIME_UNAVAILABLE");
  return hostname.startsWith("http://") || hostname.startsWith("https://") ? hostname.replace(/\/$/, "") : `https://${hostname}`;
}

export async function callCodexRuntime<T extends RuntimePayload>(action: string, body: Record<string, unknown>, timeoutMs = 60000): Promise<T> {
  let token: string | undefined;
  try {
    token = await getVercelOidcToken();
  } catch (error) {
    throw new Error(`CODEX_INTERNAL_AUTH_FAILED:${describeError(error)}`);
  }
  if (!token) throw new Error("CODEX_INTERNAL_AUTH_UNAVAILABLE");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response: Response;
    try {
      response = await fetch(`${runtimeOrigin()}/api/codex-runtime/${encodeURIComponent(action)}`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: controller.signal
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      throw new Error(`CODEX_RUNTIME_FETCH_FAILED:${describeError(error)}`);
    }
    const payload = await response.json().catch(() => ({ error: `CODEX_RUNTIME_HTTP_${response.status}` })) as T;
    if (!response.ok || payload.error) {
      const detail = payload.error ? describeError(payload.error) : `CODEX_RUNTIME_HTTP_${response.status}`;
      throw new Error(detail);
    }
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
  // Vercel terminates the route at 300 seconds. Keep the actual model turn well
  // below that hard ceiling and reserve time for OIDC, worker acquisition,
  // account/model preflight, JSON parsing and the Workflow step response.
  const generationTimeoutMs = boundedGenerationTimeout(args.timeoutMs);
  const runtimeTimeoutMs = Math.min(generationTimeoutMs + RUNTIME_OVERHEAD_BUDGET_MS, MAX_RUNTIME_REQUEST_MS);
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
    timeoutMs: generationTimeoutMs
  }, runtimeTimeoutMs);
  return { value: args.parse(result.value), usage: result.usage };
}
