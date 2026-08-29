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

export async function getCodexConnectionStatus(): Promise<CodexConnectionStatus> {
  const response = await fetch(CODEX_CONNECTION_URL, { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "CODEX_CONNECTION_STATUS_FAILED");
  return payload as CodexConnectionStatus;
}

export async function disconnectCodexChatGPT() {
  const response = await fetch(CODEX_CONNECTION_URL, { method: "DELETE" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "CODEX_DISCONNECT_FAILED");
}

export async function connectCodexChatGPT(options?: {
  onEvent?: (event: CodexDeviceEvent) => void;
  openVerificationPage?: boolean;
}): Promise<CodexConnectedEvent> {
  options?.onEvent?.({ type: "starting", message: "Codex ChatGPT 로그인을 준비하고 있습니다." });
  const response = await fetch(CODEX_CONNECTION_URL, { method: "POST", cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? "CODEX_LOGIN_START_FAILED");

  if (payload.type === "connected") {
    const connected: CodexConnectedEvent = {
      type: "connected",
      authMode: payload.authMode ?? null,
      email: payload.email ?? null,
      planType: payload.planType ?? null,
      model: payload.model ?? "gpt-5.6-luna",
      modelAvailable: payload.modelAvailable === true,
      rateLimits: payload.rateLimits ?? null
    };
    options?.onEvent?.(connected);
    return connected;
  }

  if (payload.type !== "device_code" || !payload.loginId || !payload.verificationUrl || !payload.userCode) {
    throw new Error("CODEX_DEVICE_CODE_START_FAILED");
  }

  const deviceEvent: CodexDeviceEvent = {
    type: "device_code",
    loginId: payload.loginId,
    verificationUrl: payload.verificationUrl,
    userCode: payload.userCode
  };
  options?.onEvent?.(deviceEvent);
  if (options?.openVerificationPage !== false) window.open(payload.verificationUrl, "_blank", "noopener,noreferrer");

  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    await sleep(1800);
    const status = await getCodexConnectionStatus();
    if (!status.connected) continue;
    const connected: CodexConnectedEvent = {
      type: "connected",
      authMode: status.authMode ?? "chatgpt",
      email: status.email ?? null,
      planType: status.planType ?? null,
      model: status.model ?? "gpt-5.6-luna",
      modelAvailable: status.modelAvailable === true,
      rateLimits: status.rateLimits ?? null
    };
    options?.onEvent?.(connected);
    return connected;
  }

  throw new Error("CODEX_LOGIN_DID_NOT_COMPLETE");
}
