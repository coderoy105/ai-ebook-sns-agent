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

const CODEX_CONNECTION_URL = "/api/auth/openrouter/connection?provider=codex";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asConnected(payload: CodexWirePayload): CodexConnectedEvent {
  return {
    type: "connected",
    authMode: payload.authMode ?? "chatgpt",
    email: payload.email ?? null,
    planType: payload.planType ?? null,
    model: payload.model ?? "gpt-5.6-luna",
    modelAvailable: payload.modelAvailable === true,
    rateLimits: payload.rateLimits ?? null
  };
}

function handleDeviceCode(payload: CodexWirePayload, options?: {
  onEvent?: (event: CodexDeviceEvent) => void;
  openVerificationPage?: boolean;
}) {
  if (!payload.loginId || !payload.verificationUrl || !payload.userCode) throw new Error("CODEX_DEVICE_CODE_START_FAILED");
  const event: CodexDeviceEvent = {
    type: "device_code",
    loginId: payload.loginId,
    verificationUrl: payload.verificationUrl,
    userCode: payload.userCode
  };
  options?.onEvent?.(event);
  if (options?.openVerificationPage !== false) window.open(payload.verificationUrl, "_blank", "noopener,noreferrer");
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

async function connectFromStream(response: Response, options?: {
  onEvent?: (event: CodexDeviceEvent) => void;
  openVerificationPage?: boolean;
}): Promise<CodexConnectedEvent> {
  if (!response.body) throw new Error("CODEX_LOGIN_STREAM_UNAVAILABLE");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let verificationOpened = false;

  const consume = (line: string): CodexConnectedEvent | null => {
    if (!line.trim()) return null;
    const payload = JSON.parse(line) as CodexWirePayload;
    if (payload.type === "error") throw new Error(payload.error ?? "CODEX_LOGIN_FAILED");
    if (payload.type === "device_code") {
      handleDeviceCode(payload, {
        ...options,
        openVerificationPage: verificationOpened ? false : options?.openVerificationPage
      });
      verificationOpened = true;
      return null;
    }
    if (payload.type === "connected") {
      const connected = asConnected(payload);
      options?.onEvent?.(connected);
      return connected;
    }
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
        return connected;
      }
    }
    if (done) break;
  }

  if (buffer.trim()) {
    const connected = consume(buffer);
    if (connected) return connected;
  }
  throw new Error("CODEX_LOGIN_DID_NOT_COMPLETE");
}

export async function connectCodexChatGPT(options?: {
  onEvent?: (event: CodexDeviceEvent) => void;
  openVerificationPage?: boolean;
}): Promise<CodexConnectedEvent> {
  options?.onEvent?.({ type: "starting", message: "Codex ChatGPT 로그인을 준비하고 있습니다." });
  const response = await fetch(CODEX_CONNECTION_URL, { method: "POST", cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as CodexWirePayload;
    throw new Error(payload.error ?? "CODEX_LOGIN_START_FAILED");
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/x-ndjson")) return connectFromStream(response, options);

  const payload = await response.json() as CodexWirePayload;
  if (payload.type === "connected") {
    const connected = asConnected(payload);
    options?.onEvent?.(connected);
    return connected;
  }
  if (payload.type !== "device_code") throw new Error("CODEX_DEVICE_CODE_START_FAILED");
  handleDeviceCode(payload, options);

  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(1800);
    const status = await getCodexConnectionStatus();
    if (!status.connected) continue;
    const connected = asConnected(status);
    options?.onEvent?.(connected);
    return connected;
  }
  throw new Error("CODEX_LOGIN_DID_NOT_COMPLETE");
}
