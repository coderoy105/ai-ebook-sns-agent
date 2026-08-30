import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const httpSource = readFileSync(new URL("../lib/export/http.ts", import.meta.url), "utf8");
const workflowSource = readFileSync(new URL("../lib/jobs/export-workflow.ts", import.meta.url), "utf8");
const storeSource = readFileSync(new URL("../lib/export/artifact-store.ts", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../components/export-download-guard.tsx", import.meta.url), "utf8");

test("export POST starts a durable workflow instead of rendering in the browser request", () => {
  assert.match(httpSource, /start\(generateBookExportWorkflow/);
  assert.doesNotMatch(httpSource, /renderBookPdf|renderBookEpub|renderBookDocx/);
  assert.match(workflowSource, /["']use workflow["']/);
  assert.match(workflowSource, /["']use step["']/);
});

test("completed export files live in a persistent sandbox artifact store", () => {
  assert.match(storeSource, /persistent:\s*true/);
  assert.match(storeSource, /Sandbox\.getOrCreate/);
  assert.match(storeSource, /writeFiles/);
  assert.match(storeSource, /readFileToBuffer/);
});

test("client waits for background completion before downloading the artifact", () => {
  const completedCheck = clientSource.indexOf('payload.status === "COMPLETED"');
  const artifactFetch = clientSource.indexOf("fetch(downloadUrl.toString()");
  assert.ok(completedCheck >= 0, "client must detect completed export status");
  assert.ok(artifactFetch > completedCheck, "artifact download must start after background completion");
  assert.match(clientSource, /앱을 닫아도 계속 진행됩니다/);
});
