import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSource = readFileSync(new URL("../app/api/books/[id]/title/route.ts", import.meta.url), "utf8");
const draftRouteSource = readFileSync(new URL("../app/api/title-suggestions/route.ts", import.meta.url), "utf8");
const launcherSource = readFileSync(new URL("../components/title-studio-launcher.tsx", import.meta.url), "utf8");
const draftStudioSource = readFileSync(new URL("../components/draft-title-studio.tsx", import.meta.url), "utf8");
const wizardSource = readFileSync(new URL("../app/books/new/book-wizard.tsx", import.meta.url), "utf8");
const shellSource = readFileSync(new URL("../app/books/[id]/book-editor-shell.tsx", import.meta.url), "utf8");
const workspaceSource = readFileSync(new URL("../app/book/page.tsx", import.meta.url), "utf8");
const overrideWorkflowSource = readFileSync(new URL("../lib/jobs/title-override-workflow.ts", import.meta.url), "utf8");

test("title API generates five structured publishing title options", () => {
  assert.match(routeSource, /book_title_suggestions/);
  assert.match(routeSource, /suggestions/);
  assert.match(routeSource, /\.length\(5\)/);
  assert.match(routeSource, /generateBackgroundStructured/);
  assert.match(routeSource, /명료형/);
  assert.match(routeSource, /상업형/);
});

test("pre-project title API can recommend five titles from wizard inputs", () => {
  assert.match(draftRouteSource, /draft_book_title_suggestions/);
  assert.match(draftRouteSource, /idea/);
  assert.match(draftRouteSource, /bookType/);
  assert.match(draftRouteSource, /aiProvider/);
  assert.match(draftRouteSource, /\.length\(5\)/);
});

test("title API persists a manual or selected title into book, blueprint and cover page", () => {
  assert.match(routeSource, /from\("books"\)[\s\S]*update\(\{ title, updated_at: now \}\)/);
  assert.match(routeSource, /selectedTitle: title/);
  assert.match(routeSource, /layout_type", "Cover"/);
  assert.match(routeSource, /titleOverride: title/);
  assert.match(routeSource, /titleSource: "user-confirmed"/);
});

test("planning title overrides are durable and converge on the latest saved title", () => {
  assert.match(routeSource, /applyTitleOverrideWorkflow/);
  assert.match(routeSource, /book\.status === "PLANNING"/);
  assert.match(overrideWorkflowSource, /sleep\("5m"\)/);
  assert.match(overrideWorkflowSource, /titleOverride/);
  assert.match(overrideWorkflowSource, /String\(book\.status\) === "PLANNING"/);
  assert.match(overrideWorkflowSource, /selectedTitle: title/);
});

test("title studio supports direct editing, AI recommendations and explicit save", () => {
  assert.match(launcherSource, /직접 제목 정하기/);
  assert.match(launcherSource, /AI 제목 5개 추천/);
  assert.match(launcherSource, /이 제목으로 저장/);
  assert.match(launcherSource, /추천 제목을 선택한 뒤 자유롭게 수정/);
  assert.match(launcherSource, /method: "PATCH"/);
});

test("new book wizard supports optional direct title and AI recommendations before creation", () => {
  assert.match(draftStudioSource, /비워두면 AI가 Blueprint에서 최종 제목/);
  assert.match(draftStudioSource, /AI 제목 5개 추천/);
  assert.match(draftStudioSource, /\/api\/title-suggestions/);
  assert.match(wizardSource, /DraftTitleStudio/);
  assert.match(wizardSource, /title\s*:\s*""/);
  assert.match(wizardSource, /\/api\/books\/\$\{payload\.bookId\}\/title/);
  assert.match(wizardSource, /AI가 Book Blueprint에서 최종 제목 결정/);
});

test("title studio is available after creation, including while Blueprint is planning", () => {
  assert.match(shellSource, /TitleStudioLauncher/);
  assert.match(shellSource, /CoverStudioLauncher/);
  assert.match(workspaceSource, /planningOnly/);
  assert.match(workspaceSource, /TitleStudioLauncher/);
});
