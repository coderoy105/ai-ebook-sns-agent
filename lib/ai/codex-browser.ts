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
  openVerificationPage?: boolean;
};

const CODEX_CONNECTION_URL = "/api/auth/openrouter/connection?provider=codex";
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;

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

function trustedOpenAiUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (
      host === "auth.openai.com" || host.endsWith(".openai.com") ||
      host === "chatgpt.com" || host.endsWith(".chatgpt.com")
    );
  } catch {
    return false;
  }
}

function prepareAuthWindow(enabled: boolean) {
  if (!enabled) return null;
  try {
    const popup = window.open("about:blank", "ai-book-studio-chatgpt");
    if (!popup) return null;
    popup.opener = null;
    popup.document.title = "ChatGPT 로그인";
    popup.document.body.innerHTML = '<main style="font-family:system-ui,sans-serif;max-width:36rem;margin:12vh auto;padding:24px;line-height:1.6"><strong>ChatGPT 로그인 페이지를 준비하고 있습니다.</strong><p>잠시만 기다려 주세요.</p></main>';
    return popup;
  } catch {
    return null;
  }
}

function openVerificationPage(url: string, popup: Window | null) {
  if (!trustedOpenAiUrl(url)) throw new Error("CODEX_LOGIN_URL_INVALID");
  if (popup && !popup.closed) {
    popup.location.replace(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

function closeAuthWindow(popup: Window | null) {
  try {
    if (popup && !popup.closed) popup.close();
  } catch {
    // Cross-origin auth windows may refuse inspection; leaving the success page open is harmless.
  }
}

function copyUserCode(userCode: string) {
  try {
    void navigator.clipboard?.writeText(userCode).catch(() => undefined);
  } catch {
    // Clipboard access is best-effort. The UI also exposes the code as a fallback.
  }
}

function handleDeviceCode(payload: CodexWirePayload, options: ConnectOptions | undefined, popup: Window | null, verificationOpened = false) {
  if (!payload.loginId || !payload.verificationUrl || !payload.userCode) throw new Error("CODEX_DEVICE_CODE_START_FAILED");
  const event: CodexDeviceEvent = {
    type: "device_code",
    loginId: payload.loginId,
    verificationUrl: payload.verificationUrl,
    userCode: payload.userCode
  };
  options?.onEvent?.(event);
  copyUserCode(payload.userCode);
  if (!verificationOpened && options?.openVerificationPage !== false) openVerificationPage(payload.verificationUrl, popup);
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

async function connectFromStream(response: Response, options: ConnectOptions | undefined, popup: Window | null): Promise<CodexConnectedEvent> {
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
      handleDeviceCode(payload, options, popup, verificationOpened);
      verificationOpened = true;
      return null;
    }
    if (payload.type === "connected") {
      const connected = asConnected(payload);
      options?.onEvent?.(connected);
      closeAuthWindow(popup);
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

export async function connectCodexChatGPT(options?: ConnectOptions): Promise<CodexConnectedEvent> {
  options?.onEvent?.({ type: "starting", message: "OpenAI 로그인 페이지를 준비하고 있습니다." });
  const popup = prepareAuthWindow(options?.openVerificationPage !== false);

  try {
    const response = await fetch(CODEX_CONNECTION_URL, { method: "POST", cache: "no-store" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as CodexWirePayload;
      throw new Error(payload.error ?? "CODEX_LOGIN_START_FAILED");
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/x-ndjson")) return await connectFromStream(response, options, popup);

    const payload = await response.json() as CodexWirePayload;
    if (payload.type === "connected") {
      const connected = asConnected(payload);
      options?.onEvent?.(connected);
      closeAuthWindow(popup);
      return connected;
    }
    if (payload.type !== "device_code") throw new Error("CODEX_DEVICE_CODE_START_FAILED");
    handleDeviceCode(payload, options, popup);

    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(1600);
      const status = await getCodexConnectionStatus();
      if (!status.connected) continue;
      const connected = asConnected(status);
      options?.onEvent?.(connected);
      closeAuthWindow(popup);
      return connected;
    }
    throw new Error("CODEX_LOGIN_DID_NOT_COMPLETE");
  } catch (error) {
    closeAuthWindow(popup);
    throw error;
  }
}
