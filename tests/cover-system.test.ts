import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCoverConcepts, normalizeCoverConcept } from "../lib/design/cover-system";

const pdfSource = readFileSync(new URL("../lib/export/pdf.tsx", import.meta.url), "utf8");
const composeSource = readFileSync(new URL("../lib/design/compose.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../app/api/books/[id]/covers/route.ts", import.meta.url), "utf8");
const studioSource = readFileSync(new URL("../components/cover-studio.tsx", import.meta.url), "utf8");

test("cover system creates three genuinely different editorial directions", () => {
  const concepts = createCoverConcepts({
    title: "기억을 대신하는 AI",
    subtitle: "우리는 무엇을 기억해야 하는가",
    bookType: "에세이",
    idea: "개인 AI가 기억과 인간관계를 바꾸는 미래에 대한 에세이",
    coreMessage: "기억을 외주화할수록 무엇을 스스로 간직할지 더 중요해진다"
  });
  assert.equal(concepts.length, 3);
  assert.equal(new Set(concepts.map((item) => item.style)).size, 3);
  assert.equal(new Set(concepts.map((item) => item.palette.name)).size, 3);
  assert.ok(new Set(concepts.map((item) => item.composition)).size >= 2);
  assert.ok(concepts.every((item) => item.version === 2));
  assert.ok(concepts.every((item) => item.avoidCliches.length > 0));
});

test("legacy generic cover data upgrades to a distinctive version 2 concept", () => {
  const concept = normalizeCoverConcept({ palette: ["paper", "charcoal", "accent"] }, {
    title: "제주 바다의 시간",
    subtitle: "섬을 읽는 작은 기록",
    bookType: "에세이",
    idea: "제주 바다와 사람의 시간을 기록한 책"
  });
  assert.equal(concept.version, 2);
  assert.notEqual(concept.palette.background, "paper");
  assert.ok(concept.visualMetaphor.length > 10);
});

test("PDF front matter uses the selected cover concept instead of a fixed AI template", () => {
  assert.match(pdfSource, /book\.cover/);
  assert.match(pdfSource, /CoverArtwork/);
  assert.match(pdfSource, /cover\.palette\.background/);
  assert.doesNotMatch(pdfSource, />AI BOOK STUDIO</);
});

test("page composition seeds three cover variants and preserves modern selections", () => {
  assert.match(composeSource, /createCoverConcepts/);
  assert.match(composeSource, /hasModernCovers/);
  assert.match(composeSource, /generatedCovers\.map/);
  assert.match(composeSource, /coverConcept: selectedCover/);
});

test("cover studio supports selection, regeneration, and legacy auto-upgrade", () => {
  assert.match(routeSource, /action === "select"/);
  assert.match(routeSource, /action === "regenerate"/);
  assert.match(routeSource, /ensureModernCovers/);
  assert.match(routeSource, /modernCoverCount\(loaded\) >= 3/);
  assert.match(studioSource, /새 3안/);
  assert.match(studioSource, /피하는 표현/);
});
