"use client";

export type CodexDeviceEvent =
  | { type: "starting"; message?: string }
  | { type: "device_code"; loginId: string; verificationUrl: string; userCode: string }
  | { type: "connected"; authMode?: string | null; email?: string | null; planType?: string | null; model: string; modelAvailable: boolean; rateLimits?: unknown }
  | { type: "error"; error: string };

export type CodexConnectedEvent = Extract<CodexDeviceEvent, { type: "connected" }>;

export type CodexConnectionStatus = {
  connected: boolean;
  backgroundReady?: boolean;
  workerConfigured?: boolean;
  serverlessFallback?: boolean;
  authMode?: string | null;
  model?: string;
  modelAvailable?: boolean | null;
  models?: string[];
  planType?: string | null;
  email?: string | null;
  rateLimits?: unknown;
  error?: string;
};

type CodexWirePayload = {
  type?: string;
  loginId?: string;
  verificationUrl?: string;
  userCode?: string;
  connected?: boolean;
  backgroundReady?: boolean;
  workerConfigured?: boolean;
  serverlessFallback?: boolean;
  authMode?: string | null;
  model?: string;
  modelAvailable?: boolean | null;
  models?: string[];
  planType?: string | null;
  email?: string | null;
  rateLimits?: unknown;
  error?: string;
};

type ConnectOptions = {
  onEvent?: (event: CodexDeviceEvent) => void;
  /** Kept for call-site compatibility. Device authorization is intentionally user-initiated. */
  openVerificationPage?: boolean;
};

const CODEX_CONNECTION_URL = "/api/auth/openrouter/connection?provider=codex";
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const CONNECTED_CONFIRMATION_MS = 850;

export const CODEX_CONNECTED_EVENT = "ai-book-studio:codex-connected";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asConnected(payload: CodexWirePayload): CodexConnectedEvent {
  return {
    type: "connected",
    authMode: payload.authMode ?? "chatgpt",
    email: payload.email ?? null,
    planType: payload.planType ?? null,
    model: payload.model ?? "",
    modelAvailable: payload.modelAvailable === true,
    rateLimits: payload.rateLimits ?? null
  };
}

export function getCodexVerificationUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const trustedHost =
      host === "auth.openai.com" || host.endsWith(".openai.com") ||
      host === "chatgpt.com" || host.endsWith(".chatgpt.com");
    return url.protocol === "https:" && trustedHost ? url.toString() : null;
  } catch {
    return null;
  }
}

function copyUserCode(userCode: string) {
  if (typeof navigator === "undefined") return;
  try {
    void navigator.clipboard?.writeText(userCode).catch(() => undefined);
  } catch {
    // Clipboard access is best-effort. The dialog keeps the code selectable as a fallback.
  }
}

function handleDeviceCode(payload: CodexWirePayload, options: ConnectOptions | undefined) {
  if (!payload.loginId || !payload.verificationUrl || !payload.userCode) throw new Error("CODEX_DEVICE_CODE_START_FAILED");
  if (!getCodexVerificationUrl(payload.verificationUrl)) throw new Error("CODEX_LOGIN_URL_INVALID");

  const event: CodexDeviceEvent = {
    type: "device_code",
    loginId: payload.loginId,
    verificationUrl: payload.verificationUrl,
    userCode: payload.userCode
  };
  options?.onEvent?.(event);
  copyUserCode(payload.userCode);
}

function emitConnected(payload: CodexWirePayload, options: ConnectOptions | undefined) {
  const connected = asConnected(payload);
  options?.onEvent?.(connected);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CODEX_CONNECTED_EVENT));
  return connected;
}

async function confirmConnected(payload: CodexWirePayload, options: ConnectOptions | undefined) {
  const connected = emitConnected(payload, options);
  // Keep the in-product confirmation visible briefly before parent screens clear the auth dialog.
  await sleep(CONNECTED_CONFIRMATION_MS);
  return connected;
}

export async function getCodexConnectionStatus(): Promise<CodexConnectionStatus> {
  const response = await fetch(CODEX_CONNECTION_URL, { cache: "no-store" });
  const payload = await response.json() as CodexWirePayload;
  if (!response.ok) throw new Error(payload.error ?? "CODEX_CONNECTION_STATUS_FAILED");
  return {
    connected: payload.connected === true,
    backgroundReady: payload.backgroundReady,
    workerConfigured: payload.workerConfigured,
    serverlessFallback: payload.serverlessFallback,
    authMode: payload.authMode,
    model: payload.model,
    modelAvailable: payload.modelAvailable,
    models: payload.models,
    planType: payload.planType,
    email: payload.email,
    rateLimits: payload.rateLimits,
    error: payload.error
  };
}

export async function disconnectCodexChatGPT() {
  const response = await fetch(CODEX_CONNECTION_URL, { method: "DELETE" });
  const payload = await response.json() as CodexWirePayload;
  if (!response.ok) throw new Error(payload.error ?? "CODEX_DISCONNECT_FAILED");
}

async function connectFromStream(response: Response, options: ConnectOptions | undefined): Promise<CodexConnectedEvent> {
  if (!response.body) throw new Error("CODEX_LOGIN_STREAM_UNAVAILABLE");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const consume = (line: string): CodexConnectedEvent | null => {
    if (!line.trim()) return null;
    const payload = JSON.parse(line) as CodexWirePayload;
    if (payload.type === "error") throw new Error(payload.error ?? "CODEX_LOGIN_FAILED");
    if (payload.type === "device_code") {
      handleDeviceCode(payload, options);
      return null;
    }
    if (payload.type === "connected") return emitConnected(payload, options);
    return null;
  };

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const connected = consume(line);
      if (connected) {
        await reader.cancel().catch(() => undefined);
        await sleep(CONNECTED_CONFIRMATION_MS);
        return connected;
      }
    }
    if (done) break;
  }

  if (buffer.trim()) {
    const connected = consume(buffer);
    if (connected) {
      await sleep(CONNECTED_CONFIRMATION_MS);
      return connected;
    }
  }
  throw new Error("CODEX_LOGIN_DID_NOT_COMPLETE");
}

export async function connectCodexChatGPT(options?: ConnectOptions): Promise<CodexConnectedEvent> {
  options?.onEvent?.({ type: "starting", message: "OpenAI 인증 코드를 준비하고 있습니다." });

  const response = await fetch(CODEX_CONNECTION_URL, { method: "POST", cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as CodexWirePayload;
    throw new Error(payload.error ?? "CODEX_LOGIN_START_FAILED");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-ndjson")) return connectFromStream(response, options);

  const payload = await response.json() as CodexWirePayload;
  if (payload.type === "connected") return confirmConnected(payload, options);
  if (payload.type !== "device_code") throw new Error("CODEX_DEVICE_CODE_START_FAILED");
  handleDeviceCode(payload, options);

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(1600);
    const status = await getCodexConnectionStatus();
    if (!status.connected) continue;
    return confirmConnected(status, options);
  }
  throw new Error("CODEX_LOGIN_DID_NOT_COMPLETE");
}
