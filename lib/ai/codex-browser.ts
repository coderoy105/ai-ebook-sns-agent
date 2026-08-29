"use client";

export type CodexDeviceEvent =
  | { type: "starting"; message?: string }
  | { type: "device_code"; loginId: string; verificationUrl: string; userCode: string; expiresInSeconds?: number }
  | { type: "connected"; authMode?: string | null; email?: string | null; planType?: string | null; model: string; modelAvailable: boolean; rateLimits?: unknown }
  | { type: "error"; error: string };

export type CodexConnectedEvent = Extract<CodexDeviceEvent, { type: "connected" }>;

export type CodexConnectionStatus = {
  connected: boolean;
  backgroundReady?: boolean;
  model?: string;
  modelAvailable?: boolean | null;
  planType?: string | null;
  email?: string | null;
  rateLimits?: unknown;
};

const CODEX_CONNECTION_URL = "/api/auth/openrouter/connection?provider=codex";

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
  const response = await fetch(CODEX_CONNECTION_URL, { method: "POST", cache: "no-store" });
  if (!response.ok || !response.body) {
    let error = "CODEX_LOGIN_START_FAILED";
    try { error = (await response.json()).error ?? error; } catch { /* no-op */ }
    throw new Error(error);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const state: { connected?: CodexConnectedEvent } = {};
  let opened = false;

  const processLine = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as CodexDeviceEvent;
    options?.onEvent?.(event);
    if (event.type === "device_code" && options?.openVerificationPage !== false && !opened) {
      opened = true;
      window.open(event.verificationUrl, "_blank", "noopener,noreferrer");
    }
    if (event.type === "error") throw new Error(event.error || "CODEX_LOGIN_FAILED");
    if (event.type === "connected") state.connected = event;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) processLine(line);
  }
  buffer += decoder.decode();
  if (buffer.trim()) processLine(buffer);

  if (!state.connected) throw new Error("CODEX_LOGIN_DID_NOT_COMPLETE");
  return state.connected;
}
