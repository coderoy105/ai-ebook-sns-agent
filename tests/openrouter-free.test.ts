import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOpenRouterContent, parseOpenRouterJson } from "../lib/ai/openrouter-free";

test("normalizes string and text-part OpenRouter content", () => {
  assert.equal(normalizeOpenRouterContent("  {\"ok\":true}  "), "{\"ok\":true}");
  assert.equal(normalizeOpenRouterContent([{ type: "text", text: "{\"ok\":" }, { type: "text", text: "true}" }]), "{\"ok\":\ntrue}");
  assert.equal(normalizeOpenRouterContent(null), "");
});

test("recovers JSON from markdown and surrounding prose", () => {
  assert.deepEqual(parseOpenRouterJson("```json\n{\"ok\":true}\n```"), { ok: true });
  assert.deepEqual(parseOpenRouterJson("Here is the result:\n{\"ok\":true}\nDone."), { ok: true });
});

test("rejects content without parseable JSON", () => {
  assert.throws(() => parseOpenRouterJson("not json"), /FREE_AI_INVALID_JSON/);
});
