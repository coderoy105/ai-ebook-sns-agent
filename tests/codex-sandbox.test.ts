import assert from "node:assert/strict";
import test from "node:test";
import { isRecoverableSandboxTransportError } from "../lib/ai/codex-sandbox";

test("detects a closed Vercel Sandbox control stream", () => {
  const error = Object.assign(new Error("Sandbox stream was closed and is not accepting commands."), {
    code: "sandbox_stream_closed"
  });
  assert.equal(isRecoverableSandboxTransportError(error), true);
});

test("detects a closed stream wrapped by sandbox acquire diagnostics", () => {
  assert.equal(
    isRecoverableSandboxTransportError(new Error("CODEX_SANDBOX_ACQUIRE_FAILED:{\"code\":\"sandbox_stream_closed\"}")),
    true
  );
});

test("does not reconnect for normal provider errors", () => {
  assert.equal(isRecoverableSandboxTransportError(new Error("CODEX_USAGE_LIMIT")), false);
  assert.equal(isRecoverableSandboxTransportError(new Error("CODEX_CONNECTION_REQUIRED")), false);
});
