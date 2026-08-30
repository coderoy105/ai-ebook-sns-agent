import assert from "node:assert/strict";
import test from "node:test";
import { isExplicitCodexReconnectError, isTransientCodexError } from "../lib/ai/transient-codex-errors";

test("Codex RPC and sandbox transport failures are transient", () => {
  assert.equal(isTransientCodexError("CODEX_RPC_TIMEOUT"), true);
  assert.equal(isTransientCodexError("CODEX_WORKER_TIMEOUT"), true);
  assert.equal(isTransientCodexError("CODEX_SANDBOX_UNAVAILABLE:{\"code\":\"sandbox_stream_closed\"}"), true);
  assert.equal(isTransientCodexError("GPT-5.6 Luna 제공자 오류: CODEX_RPC_TIMEOUT"), true);
});

test("real account disconnects are not transient", () => {
  assert.equal(isTransientCodexError("CODEX_CONNECTION_REQUIRED"), false);
  assert.equal(isTransientCodexError("CODEX_CONNECTION_EXPIRED"), false);
  assert.equal(isExplicitCodexReconnectError("CODEX_CONNECTION_REQUIRED"), true);
  assert.equal(isExplicitCodexReconnectError("CODEX_CONNECTION_EXPIRED"), true);
});
