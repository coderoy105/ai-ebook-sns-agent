import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const CODEX_LUNA_MODEL = "gpt-5.6-luna";

export type CodexWorkerStatus = {
  connected: boolean;
  authMode: string | null;
  email: string | null;
  planType: string | null;
  model: string;
  modelAvailable: boolean;
  models: string[];
  rateLimits: unknown;
};

type WorkerRequest = {
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  timeoutMs?: number;
};

function workerConfig() {
  const baseUrl = process.env.CODEX_WORKER_URL?.trim().replace(/\/$/, "") ?? "";
  const secret = process.env.CODEX_WORKER_SHARED_SECRET?.trim() ?? "";
  return { baseUrl, secret };
}

export function codexWorkerConfigured() {
  const { baseUrl, secret } = workerConfig();
  return Boolean(baseUrl && secret.length >= 32);
}

function signature(secret: string, timestamp: string, nonce: string, method: string, pathWithQuery: string, bodyText: string) {
  const bodyHash = createHash("sha256").update(bodyText).digest("hex");
  const canonical = `${timestamp}\n${nonce}\n${method}\n${pathWithQuery}\n${bodyHash}`;
  return createHmac("sha256", secret).update(canonical).digest("hex");
}

export async function callCodexWorker<T>(pathWithQuery: string, request: WorkerRequest = {}): Promise<T> {
  const { baseUrl, secret } = workerConfig();
  if (!baseUrl || secret.length < 32) throw new Error("CODEX_WORKER_UNAVAILABLE");
  if (!pathWithQuery.startsWith("/")) throw new Error("CODEX_WORKER_INVALID_PATH");

  const method = request.method ?? (request.body ? "POST" : "GET");
  const bodyText = request.body ? JSON.stringify(request.body) : "";
  const timestamp = Date.now().toString();
  const nonce = randomUUID();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 30000);

  try {
    const response = await fetch(`${baseUrl}${pathWithQuery}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-bookstudio-timestamp": timestamp,
        "x-bookstudio-nonce": nonce,
        "x-bookstudio-signature": signature(secret, timestamp, nonce, method, pathWithQuery, bodyText)
      },
      body: bodyText || undefined,
      cache: "no-store",
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({ error: `CODEX_WORKER_HTTP_${response.status}` })) as T & { error?: string };
    if (!response.ok || payload?.error) throw new Error(payload?.error ?? `CODEX_WORKER_HTTP_${response.status}`);
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("CODEX_WORKER_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function readCodexWorkerStatus(userId: string) {
  return callCodexWorker<CodexWorkerStatus>(`/auth/status?userId=${encodeURIComponent(userId)}`);
}

export async function hasCodexWorkerConnection(userId: string) {
  if (!codexWorkerConfigured()) return false;
  try {
    const status = await readCodexWorkerStatus(userId);
    return status.connected && status.authMode === "chatgpt" && status.modelAvailable;
  } catch {
    return false;
  }
}

export async function generateCodexWorkerStructured<T>(userId: string, args: {
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  system: string;
  prompt: string;
  timeoutMs?: number;
  parse: (value: unknown) => T;
}) {
  const result = await callCodexWorker<{
    value: unknown;
    usage: { inputTokens: number; outputTokens: number; durationMs: number; model: string; requestId?: string };
  }>("/generate", {
    method: "POST",
    timeoutMs: args.timeoutMs ?? 240000,
    body: {
      userId,
      model: CODEX_LUNA_MODEL,
      schemaName: args.schemaName,
      jsonSchema: args.jsonSchema,
      system: args.system,
      prompt: args.prompt,
      timeoutMs: args.timeoutMs
    }
  });
  return { value: args.parse(result.value), usage: result.usage };
}

// Exported only for deterministic unit tests of the signature contract.
export function verifyCodexWorkerSignatureForTest(secret: string, signatureHex: string, timestamp: string, nonce: string, method: string, pathWithQuery: string, bodyText: string) {
  const expected = signature(secret, timestamp, nonce, method, pathWithQuery, bodyText);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signatureHex, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
