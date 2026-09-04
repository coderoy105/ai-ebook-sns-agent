import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const wizard = readFileSync(new URL("../app/books/new/book-wizard.tsx", import.meta.url), "utf8");
const studio = readFileSync(new URL("../app/templates/new/template-studio.tsx", import.meta.url), "utf8");
const templateApi = readFileSync(new URL("../app/api/design-templates/route.ts", import.meta.url), "utf8");
const createBookRoute = readFileSync(new URL("../app/api/books/route.ts", import.meta.url), "utf8");
const compose = readFileSync(new URL("../lib/design/compose.ts", import.meta.url), "utf8");
const reader = readFileSync(new URL("../app/read/page.tsx", import.meta.url), "utf8");
const readerCss = readFileSync(new URL("../app/read/read.module.css", import.meta.url), "utf8");
const pdf = readFileSync(new URL("../lib/export/pdf.tsx", import.meta.url), "utf8");
const epub = readFileSync(new URL("../lib/export/epub.ts", import.meta.url), "utf8");

test("design step exposes real sample books and a reusable custom template studio", () => {
  assert.match(wizard, /샘플 책 보기/);
  assert.match(wizard, /\/templates\/new/);
  assert.match(wizard, /\/api\/design-templates/);
  assert.match(studio, /TemplateBookPreview/);
  assert.match(studio, /템플릿 저장/);
});

test("custom template library is account-owned and server persisted", () => {
  assert.match(templateApi, /ownerUserId: user\.id/);
  assert.match(templateApi, /from\("templates"\)/);
  assert.match(createBookRoute, /assertTemplateAccess\(templateId, user\.id\)/);
});

test("selected template drives composition, web reader, PDF and EPUB", () => {
  assert.match(compose, /resolveRuntimeDesign/);
  assert.match(compose, /template_id: design\.id/);
  assert.match(reader, /data-content-width/);
  assert.match(readerCss, /--reader-accent/);
  assert.match(pdf, /pageStyleFor\(book/);
  assert.match(pdf, /book\.design\.accentColor/);
  assert.match(epub, /book\.design\.paperTone/);
  assert.match(epub, /book\.design\.headingFamily/);
});
