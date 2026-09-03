import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { computeWordBudget, planBookLength } from "@/lib/book-types/engine";
import { fitComposedPagesToTarget, type FittablePageRow } from "@/lib/design/page-fit";

const promptsSource = readFileSync(new URL("../lib/ai/prompts.ts", import.meta.url), "utf8");

test("20-page practical books use a short-book outline instead of long-book defaults", () => {
  const plan = planBookLength(20, "AI / 실용서");
  assert.equal(plan.targetPages, 20);
  assert.equal(plan.frontMatterPages, 2);
  assert.equal(plan.contentPages, 18);
  assert.ok(plan.chapterRange[1] <= 5, `expected a compact chapter range, got ${plan.chapterRange.join("-")}`);
  assert.ok(plan.sectionRange[1] <= 3, `expected compact sections, got ${plan.sectionRange.join("-")}`);
  assert.equal(plan.targetWords, 18 * 330);
  assert.equal(computeWordBudget(20, "AI / 실용서"), plan.targetWords);
});

test("short fiction and children's books also scale structure to their actual budget", () => {
  const fiction = planBookLength(20, "미스터리 로맨스");
  const children = planBookLength(20, "아동용");
  assert.ok(fiction.chapterRange[1] < 18, "20-page fiction must not use the old 18-chapter minimum");
  assert.ok(children.chapterRange[1] < 8, "20-page children's books must not use the old 8-chapter minimum");
  assert.ok(children.sectionRange[1] <= 1, "short children's chapters should not be fragmented into many sections");
});

test("planner prompt treats the selected page count as the final published-book target", () => {
  assert.match(promptsSource, /FINAL published-book target/);
  assert.match(promptsSource, /REQUIRED chapter count range for this length/);
  assert.match(promptsSource, /DO NOT add extra prose pages on top of the final page target/);
  assert.match(promptsSource, /sum of all Chapter targetWords should stay within roughly ±5%/);
});

test("canonical composed pages are merged or split to the requested final count without dropping text", () => {
  const base = (index: number, layout_type: string, markdown = ""): FittablePageRow => ({
    page_number: index + 1,
    layout_type,
    content: markdown ? { markdown, sectionId: `s-${index}` } : {}
  });
  const content = Array.from({ length: 18 }, (_, index) => base(index + 5, "Body", `문장 ${index}. `.repeat(90)));
  const oversized = [
    base(0, "Cover"),
    base(1, "TableOfContents"),
    base(2, "ChapterOpening"),
    base(3, "ChapterOpening"),
    base(4, "ChapterOpening"),
    ...content
  ];
  const before = oversized.map((row) => typeof row.content.markdown === "string" ? row.content.markdown : "").join("").replace(/\s+/g, "");
  const fitted = fitComposedPagesToTarget(oversized, 20);
  const after = fitted.map((row) => typeof row.content.markdown === "string" ? row.content.markdown : "").join("").replace(/\s+/g, "");
  assert.equal(fitted.length, 20);
  assert.equal(after, before);
  assert.deepEqual(fitted.map((row) => row.page_number), Array.from({ length: 20 }, (_, index) => index + 1));

  const undersized = [
    base(0, "Cover"),
    base(1, "TableOfContents"),
    base(2, "Body", "첫 문장입니다. ".repeat(260))
  ];
  assert.equal(fitComposedPagesToTarget(undersized, 8).length, 8);
});
