import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const httpSource = readFileSync(new URL("../lib/export/http.ts", import.meta.url), "utf8");
const workflowSource = readFileSync(new URL("../lib/jobs/export-workflow.ts", import.meta.url), "utf8");
const backgroundSource = readFileSync(new URL("../lib/export/background.ts", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("../lib/export/artifact-store.ts", import.meta.url), "utf8");
const progressSource = readFileSync(new URL("../lib/export/progress.ts", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../components/export-download-guard.tsx", import.meta.url), "utf8");

test("export POST starts a durable workflow instead of rendering in the browser request", () => {
  assert.match(httpSource, /start\(generateBookExportWorkflow/);
  assert.doesNotMatch(httpSource, /renderBookPdf|renderBookEpub|renderBookDocx/);
  assert.match(workflowSource, /["']use workflow["']/);
  assert.match(workflowSource, /["']use step["']/);
});

test("long PDFs are rendered in bounded workflow steps instead of one 300 second step", () => {
  assert.match(workflowSource, /preparePdfStep/);
  assert.match(workflowSource, /renderPdfFrontStep/);
  assert.match(workflowSource, /renderPdfChapterStep/);
  assert.match(workflowSource, /for \(let chapterIndex = 0; chapterIndex < plan\.chapterCount/);
  assert.match(workflowSource, /finalizePdfStep/);
  assert.match(backgroundSource, /writeExportChunk/);
  assert.match(backgroundSource, /readExportChunk/);
});

test("completed export files and intermediate PDF chunks live in a persistent sandbox", () => {
  assert.match(storeSource, /persistent:\s*true/);
  assert.match(storeSource, /Sandbox\.getOrCreate/);
  assert.match(storeSource, /writeExportChunk/);
  assert.match(storeSource, /readExportChunk/);
  assert.match(storeSource, /writeFiles/);
  assert.match(storeSource, /readFileToBuffer/);
});

test("export progress includes a heartbeat so dead workflow jobs can be replaced", () => {
  assert.match(progressSource, /updatedAt/);
  assert.match(httpSource, /BACKGROUND_HEARTBEAT_MAX_AGE_MS/);
  assert.match(httpSource, /STALE_BACKGROUND_EXPORT_REPLACED/);
  assert.match(httpSource, /stale/);
});

test("client restores background progress after returning and never downloads before ready", () => {
  const completedCheck = clientSource.indexOf('payload.status === "COMPLETED"');
  const artifactFetch = clientSource.indexOf("fetch(downloadUrlFor(target, jobId).toString()");
  assert.ok(completedCheck >= 0, "client must detect completed export status");
  assert.ok(artifactFetch > completedCheck, "artifact download must start after background completion");
  assert.match(clientSource, /restoreBackgroundJob/);
  assert.match(clientSource, /payload\.stale/);
  assert.match(clientSource, /앱을 닫아도 계속 진행됩니다/);
});

test("direct browser navigation to a running export returns to the editor instead of raw JSON", () => {
  assert.match(httpSource, /acceptHeader\?\.includes\("text\/html"\)/);
  assert.match(httpSource, /status: 303/);
  assert.match(httpSource, /\/books\/\$\{encodeURIComponent\(bookId\)\}/);
});
