import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../lib/export/pdf.tsx", import.meta.url), "utf8");

test("PDF renderer does not use fixed absolute footer layout", () => {
  assert.doesNotMatch(source, /\bfixed\b/);
  assert.doesNotMatch(source, /position\s*:\s*["']absolute["']/);
});

test("PDF renderer validates the generated PDF signature", () => {
  assert.match(source, /PDF_RENDER_INVALID/);
  assert.match(source, /%PDF/);
});
