import assert from "node:assert/strict";
import test from "node:test";
import { createHash, createHmac } from "node:crypto";
import { CODEX_LUNA_MODEL, verifyCodexWorkerSignatureForTest } from "@/lib/ai/codex-worker";

test("Codex worker keeps Luna as a candidate that must be model/list verified", () => {
  assert.equal(CODEX_LUNA_MODEL, "gpt-5.6-luna");
});

test("Codex worker HMAC binds timestamp nonce method path and body", () => {
  const secret = "0123456789abcdef0123456789abcdef";
  const timestamp = "1787990000000";
  const nonce = "11111111-2222-4333-8444-555555555555";
  const method = "POST";
  const path = "/generate";
  const body = JSON.stringify({ userId: "11111111-2222-4333-8444-555555555555", prompt: "hello" });
  const bodyHash = createHash("sha256").update(body).digest("hex");
  const canonical = `${timestamp}\n${nonce}\n${method}\n${path}\n${bodyHash}`;
  const signature = createHmac("sha256", secret).update(canonical).digest("hex");

  assert.equal(verifyCodexWorkerSignatureForTest(secret, signature, timestamp, nonce, method, path, body), true);
  assert.equal(verifyCodexWorkerSignatureForTest(secret, signature, timestamp, nonce, method, "/models", body), false);
  assert.equal(verifyCodexWorkerSignatureForTest(secret, signature, timestamp, nonce, method, path, `${body}x`), false);
});
