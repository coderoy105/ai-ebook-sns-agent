import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflowSource = readFileSync(new URL("../lib/jobs/book-autopilot-workflow.ts", import.meta.url), "utf8");
const starterSource = readFileSync(new URL("../lib/jobs/auto-book-generation.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../app/api/books/[id]/autopilot/route.ts", import.meta.url), "utf8");
const progressSource = readFileSync(new URL("../app/books/[id]/generation-progress.tsx", import.meta.url), "utf8");

test("workspace registers a durable server autopilot and retries registration while online", () => {
  assert.match(progressSource, /\/api\/books\/\$\{bookId\}\/autopilot/);
  assert.match(progressSource, /method: "POST"/);
  assert.match(progressSource, /setTimeout\(\(\) => \{ void registerAutopilot\(\); \}, 5000\)/);
});

test("autopilot endpoint is idempotent and starts a Vercel Workflow", () => {
  assert.match(routeSource, /start\(completeBookAutopilotWorkflow/);
  assert.match(routeSource, /autopilotRunId/);
  assert.match(routeSource, /reused: true/);
  assert.match(routeSource, /background: true/);
});

test("autopilot waits durably for Blueprint and hands off to manuscript generation", () => {
  assert.match(workflowSource, /"use workflow"/);
  assert.match(workflowSource, /await sleep\(inspection\.waitFor\)/);
  assert.match(workflowSource, /state: "start"/);
  assert.match(workflowSource, /startAutomaticBookGeneration/);
  assert.match(workflowSource, /휴대폰을 끄거나 브라우저를 닫아도/);
  assert.match(workflowSource, /WAITING_LIMIT/);
  assert.match(workflowSource, /provider === "codex" \? "1h" : "24h"/);
});

test("server-side handoff reuses an existing manuscript workflow instead of duplicating it", () => {
  assert.match(starterSource, /ACTIVE_GENERATION_STATUSES/);
  assert.match(starterSource, /job\?\.workflow_run_id/);
  assert.match(starterSource, /start\(generateFreeBookWorkflow/);
  assert.match(starterSource, /Promise\.allSettled/);
  assert.match(starterSource, /phone, tab and/);
});
