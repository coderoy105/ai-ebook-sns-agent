import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { CODEX_LUNA_MODEL, resolveCodexCliEntry } from "@/lib/ai/codex-runtime";

test("Codex Plus uses GPT-5.6 Luna", () => {
  assert.equal(CODEX_LUNA_MODEL, "gpt-5.6-luna");
});

test("official Codex CLI entry resolves after npm install", () => {
  const path = resolveCodexCliEntry();
  assert.match(path, /codex[\\/]bin[\\/]codex\.js$/);
  assert.equal(existsSync(path), true);
});
