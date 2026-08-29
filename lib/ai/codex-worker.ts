import { callCodexSandboxWorker, codexSandboxSupported } from "@/lib/ai/codex-sandbox";
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

const encoder = new TextEncoder();

function workerConfig() {
  const baseUrl = process.env.CODEX_WORKER_URL?.trim().replace(/\/$/, "") ?? "";
  const secret = process.env.CODEX_WORKER_SHARED_SECRET?.trim() ?? "";
  return { baseUrl, secret };
}

export function codexWorkerConfigured() {
  const { baseUrl, secret } = workerConfig();
  return Boolean(baseUrl && secret.length >= 32) || codexSandboxSupported();
}

function bytesToHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(value: string) {
  return bytesToHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

async function signature(secret: string, timestamp: string, nonce: string, method: string, pathWithQuery: string, bodyText: string) {
  const bodyHash = await sha256Hex(bodyText);
  const canonical = `${timestamp}\n${nonce}\n${method}\n${pathWithQuery}\n${bodyHash}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return bytesToHex(await crypto.subtle.sign("HMAC", key, encoder.encode(canonical)));
}

export async function callCodexWorker<T>(pathWithQuery: string, request: WorkerRequest = {}): Promise<T> {
  const { baseUrl, secret } = workerConfig();
  if (!baseUrl || secret.length < 32) {
    if (codexSandboxSupported()) return callCodexSandboxWorker<T>(pathWithQuery, request);
    throw new Error("CODEX_WORKER_UNAVAILABLE");
  }
  if (!pathWithQuery.startsWith("/")) throw new Error("CODEX_WORKER_INVALID_PATH");

  const method = request.method ?? (request.body ? "POST" : "GET");
  const bodyText = request.body ? JSON.stringify(request.body) : "";
  const timestamp = Date.now().toString();
  const nonce = crypto.randomUUID();
  const requestSignature = await signature(secret, timestamp, nonce, method, pathWithQuery, bodyText);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs ?? 30000);

  try {
    const response = await fetch(`${baseUrl}${pathWithQuery}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-bookstudio-timestamp": timestamp,
        "x-bookstudio-nonce": nonce,
        "x-bookstudio-signature": requestSignature
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

// Exported only for deterministic unit tests of the shared HMAC contract.
export async function verifyCodexWorkerSignatureForTest(secret: string, signatureHex: string, timestamp: string, nonce: string, method: string, pathWithQuery: string, bodyText: string) {
  const expected = await signature(secret, timestamp, nonce, method, pathWithQuery, bodyText);
  if (expected.length !== signatureHex.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected.charCodeAt(index) ^ signatureHex.charCodeAt(index);
  }
  return difference === 0;
}
