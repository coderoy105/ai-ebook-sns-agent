import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("../app/api/books/[id]/title/route.ts", import.meta.url), "utf8");
const launcherSource = readFileSync(new URL("../components/title-studio-launcher.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../app/books/[id]/book-editor-shell.tsx", import.meta.url), "utf8");

test("title API generates five structured publishing title options", () => {
  assert.match(routeSource, /book_title_suggestions/);
  assert.match(routeSource, /suggestions/);
  assert.match(routeSource, /\.length\(5\)/);
  assert.match(routeSource, /generateBackgroundStructured/);
  assert.match(routeSource, /명료형/);
  assert.match(routeSource, /상업형/);
});

test("title API persists a manual or selected title into book and active blueprint", () => {
  assert.match(routeSource, /from\("books"\)[\s\S]*update\(\{ title, updated_at: now \}\)/);
  assert.match(routeSource, /selectedTitle: title/);
  assert.match(routeSource, /layout_type", "Cover"/);
});

test("title studio supports direct editing, AI recommendations and explicit save", () => {
  assert.match(launcherSource, /직접 제목 정하기/);
  assert.match(launcherSource, /AI 제목 5개 추천/);
  assert.match(launcherSource, /이 제목으로 저장/);
  assert.match(launcherSource, /추천 제목을 선택한 뒤 자유롭게 수정/);
  assert.match(launcherSource, /method: "PATCH"/);
});

test("manuscript workspace exposes title studio beside cover studio", () => {
  assert.match(shellSource, /TitleStudioLauncher/);
  assert.match(shellSource, /CoverStudioLauncher/);
});
