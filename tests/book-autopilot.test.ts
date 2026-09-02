import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflowSource = readFileSync(new URL("../lib/jobs/book-autopilot-workflow.ts", import.meta.url), "utf8");
const starterSource = readFileSync(new URL("../lib/jobs/auto-book-generation.ts", import.meta.url), "utf8");
const registrationSource = readFileSync(new URL("../lib/jobs/register-book-autopilot.ts", import.meta.url), "utf8");
const routeSource = readFileSync(new URL("../app/api/books/[id]/autopilot/route.ts", import.meta.url), "utf8");
const createRouteSource = readFileSync(new URL("../app/api/books/route.ts", import.meta.url), "utf8");
const progressSource = readFileSync(new URL("../app/books/[id]/generation-progress.tsx", import.meta.url), "utf8");

test("book create request registers autopilot on the server before returning to the phone", () => {
  assert.match(createRouteSource, /corePost/);
  assert.match(createRouteSource, /registerBookAutopilot\(bookId, user\.id\)/);
  assert.match(createRouteSource, /autopilotRegistered: true/);
  assert.match(createRouteSource, /phoneOffSafe: true/);
  assert.match(createRouteSource, /autopilotRetryRequired: true/);
});

test("workspace also retries durable autopilot registration as a fallback", () => {
  assert.match(progressSource, /\/api\/books\/\$\{bookId\}\/autopilot/);
  assert.match(progressSource, /method: "POST"/);
  assert.match(progressSource, /setTimeout\(\(\) => \{ void registerAutopilot\(\); \}, 5000\)/);
  assert.match(progressSource, /서버 자동 실행/);
  assert.match(progressSource, /서버 등록 재시도 중/);
});

test("autopilot registration is idempotent and starts one durable Vercel Workflow", () => {
  assert.match(registrationSource, /start\(completeBookAutopilotWorkflow/);
  assert.match(registrationSource, /autopilotRunId/);
  assert.match(registrationSource, /reused: true/);
  assert.match(registrationSource, /background: true/);
  assert.match(routeSource, /registerBookAutopilot/);
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
