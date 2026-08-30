export function codexErrorMessage(value: unknown) {
  return value instanceof Error ? value.message : String(value ?? "");
}

export function isTransientCodexError(value: unknown) {
  const message = codexErrorMessage(value);
  return /CODEX_RPC_TIMEOUT|CODEX_GENERATION_TIMEOUT|CODEX_WORKER_TIMEOUT|CODEX_RUNTIME_FETCH_FAILED|CODEX_RUNTIME_HTTP_5\d\d|CODEX_WORKER_HTTP_5\d\d|CODEX_SANDBOX_(?:UNAVAILABLE|ACQUIRE_FAILED|LOCAL_CALL_FAILED|WORKER_START_FAILED)|sandbox_stream_closed|Sandbox stream was closed|CODEX_APP_SERVER_(?:CLOSED|EXITED|FAILED)|CODEX_INTERNAL_AUTH_(?:FAILED|UNAVAILABLE)/i.test(message);
}

export function isExplicitCodexReconnectError(value: unknown) {
  const message = codexErrorMessage(value);
  return /^(?:CODEX_CONNECTION_REQUIRED|CODEX_CONNECTION_EXPIRED)$/i.test(message.trim());
}
