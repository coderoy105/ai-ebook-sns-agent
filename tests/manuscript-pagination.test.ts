import assert from "node:assert/strict";
import test from "node:test";
import { paginateMeasuredManuscript, paginationIsLossless, preferredNaturalBreak } from "@/lib/pagination/manuscript";

test("prefers paragraph boundaries near the end of a page", () => {
  const text = "첫 문단입니다. 충분히 길게 이어집니다.\n\n두 번째 문단입니다. 다음 문장입니다.";
  const boundary = preferredNaturalBreak(text, 0.35);
  assert.equal(text.slice(0, boundary).endsWith("\n\n"), true);
});

test("falls back to a sentence boundary before word/character splitting", () => {
  const text = "첫 번째 문장입니다. 두 번째 문장이 꽤 길게 이어집니다. 세 번째 문장입니다.";
  const boundary = preferredNaturalBreak(text, 0.3);
  assert.match(text.slice(0, boundary), /[.!?。！？]\s*$/);
});

test("measured pagination is lossless and automatically creates following pages", () => {
  const source = [
    "첫 페이지에 들어갈 첫 문단입니다.\n\n",
    "두 번째 문단은 다음 페이지로 자연스럽게 이동해야 합니다. 문장 경계도 유지합니다.\n\n",
    "세 번째 문단도 이어집니다."
  ].join("");
  const pages = paginateMeasuredManuscript(source, (content) => content.length <= 54);
  assert.ok(pages.length >= 2);
  assert.equal(paginationIsLossless(source, pages), true);
  assert.equal(pages.join(""), source);
});

test("a single overlong paragraph eventually splits without dropping characters", () => {
  const source = "가나다라마바사아자차카타파하".repeat(30);
  const pages = paginateMeasuredManuscript(source, (content) => content.length <= 37);
  assert.ok(pages.length > 1);
  assert.equal(paginationIsLossless(source, pages), true);
  assert.ok(pages.every((page, index) => index === pages.length - 1 || page.length <= 37));
});
