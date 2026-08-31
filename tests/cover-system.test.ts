import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createCoverConcepts, normalizeCoverConcept } from "../lib/design/cover-system";

const pdfSource = readFileSync(new URL("../lib/export/pdf.tsx", import.meta.url), "utf8");
const composeSource = readFileSync(new URL("../lib/design/compose.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../app/api/books/[id]/covers/route.ts", import.meta.url), "utf8");
const studioSource = readFileSync(new URL("../components/cover-studio.tsx", import.meta.url), "utf8");
const artSource = readFileSync(new URL("../components/book-cover-art.tsx", import.meta.url), "utf8");
const artCssSource = readFileSync(new URL("../components/book-cover-art.module.css", import.meta.url), "utf8");

test("cover system creates three genuinely different publisher directions", () => {
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
  assert.ok(new Set(concepts.map((item) => item.layout)).size >= 2);
  assert.ok(concepts.every((item) => item.version === 2));
  assert.ok(concepts.every((item) => item.avoidCliches.length > 0));
  assert.ok(concepts.every((item) => item.imprint === "AI BOOK STUDIO"));
  assert.ok(concepts.every((item) => /^ABS-\d{3}$/.test(item.catalogue)));
  assert.ok(concepts.every((item) => item.editionLabel.length > 4));
});

test("legacy generic cover data upgrades to the publisher renderer without destructive migration", () => {
  const concept = normalizeCoverConcept({ palette: ["paper", "charcoal", "accent"] }, {
    title: "제주 바다의 시간",
    subtitle: "섬을 읽는 작은 기록",
    bookType: "에세이",
    idea: "제주 바다와 사람의 시간을 기록한 책"
  });
  assert.equal(concept.version, 2);
  assert.notEqual(concept.palette.background, "paper");
  assert.ok(concept.visualMetaphor.length > 10);
  assert.ok(concept.layout.length > 4);
  assert.ok(concept.finish.length > 3);
  assert.equal(concept.imprint, "AI BOOK STUDIO");
});

test("web cover uses book-jacket hierarchy instead of a rounded decorative card", () => {
  assert.match(artSource, /data-layout=/);
  assert.match(artSource, /styles\.topline/);
  assert.match(artSource, /styles\.footer/);
  assert.match(artSource, /concept\.editionLabel/);
  assert.match(artSource, /concept\.catalogue/);
  assert.match(artCssSource, /aspect-ratio:\s*2 \/ 3/);
  assert.match(artCssSource, /container-type:\s*inline-size/);
  assert.match(artCssSource, /data-layout="quiet-literary"/);
  assert.match(artCssSource, /data-layout="poster"/);
  assert.match(artCssSource, /\.spine/);
});

test("PDF front matter uses the selected publisher cover concept instead of a fixed AI template", () => {
  assert.match(pdfSource, /book\.cover/);
  assert.match(pdfSource, /CoverArtwork/);
  assert.match(pdfSource, /CoverTitleBlock/);
  assert.match(pdfSource, /cover\.palette\.background/);
  assert.match(pdfSource, /cover\.imprint/);
  assert.match(pdfSource, /cover\.editionLabel/);
  assert.doesNotMatch(pdfSource, />AI BOOK STUDIO</);
});

test("page composition seeds three cover variants and preserves modern selections", () => {
  assert.match(composeSource, /createCoverConcepts/);
  assert.match(composeSource, /hasModernCovers/);
  assert.match(composeSource, /generatedCovers\.map/);
  assert.match(composeSource, /coverConcept: selectedCover/);
});

test("cover studio supports selection, regeneration, and publication direction details", () => {
  assert.match(routeSource, /action === "select"/);
  assert.match(routeSource, /action === "regenerate"/);
  assert.match(routeSource, /ensureModernCovers/);
  assert.match(routeSource, /modernCoverCount\(loaded\) >= 3/);
  assert.match(studioSource, /새 3안/);
  assert.match(studioSource, /피하는 표현/);
  assert.match(studioSource, /출판 편집 그리드/);
  assert.match(studioSource, /소프트 터치/);
});
