import { Sandbox } from "@vercel/sandbox";

const SANDBOX_NAME = "ai-book-studio-codex-runtime-v2";
const REPOSITORY_URL = "https://github.com/coderoy105/ai-ebook-sns-agent.git";
const SANDBOX_ROOT = "/vercel/sandbox";
const WORKER_DIR = `${SANDBOX_ROOT}/services/codex-worker`;
const VERSION_FILE = `${SANDBOX_ROOT}/.ai-book-codex-worker-version`;
const WORKER_VERSION = "2026-08-30-sandbox-runtime-v2";
const SANDBOX_TIMEOUT_MS = 44 * 60 * 1000;
const WORKER_PORT = "8788";

type SandboxWorkerRequest = {
  method?: "GET" | "POST";
  body?: Record<string, unknown>;
  timeoutMs?: number;
};

type LocalResponse = {
  status?: number;
  body?: unknown;
};

let sandboxPromise: Promise<Sandbox> | null = null;

function commandError(prefix: string, exitCode: number, stderr: string) {
  const detail = stderr.trim().slice(0, 1000);
  return new Error(detail ? `${prefix}: ${detail}` : `${prefix}: exit ${exitCode}`);
}

async function readVersion(sandbox: Sandbox) {
  try {
    return String(await sandbox.fs.readFile(VERSION_FILE, "utf8")).trim();
  } catch {
    return "";
  }
}

async function prepareWorkerFiles(sandbox: Sandbox) {
  if (await readVersion(sandbox) === WORKER_VERSION) return;

  const sync = await sandbox.runCommand({
    cmd: "sh",
    args: ["-lc", "git fetch --depth=1 origin main && git reset --hard FETCH_HEAD"],
    cwd: SANDBOX_ROOT,
    timeoutMs: 90_000
  });
  if (sync.exitCode !== 0) throw commandError("CODEX_SANDBOX_GIT_SYNC_FAILED", sync.exitCode, await sync.stderr());

  const install = await sandbox.runCommand({
    cmd: "npm",
    args: ["install", "--omit=dev", "--strict-allow-scripts"],
    cwd: WORKER_DIR,
    timeoutMs: 180_000
  });
  if (install.exitCode !== 0) throw commandError("CODEX_SANDBOX_INSTALL_FAILED", install.exitCode, await install.stderr());

  await sandbox.fs.writeFile(VERSION_FILE, `${WORKER_VERSION}\n`);
}

async function localRequest<T = unknown>(sandbox: Sandbox, pathWithQuery: string, request: SandboxWorkerRequest = {}): Promise<T> {
  const method = request.method ?? (request.body ? "POST" : "GET");
  const bodyText = request.body ? JSON.stringify(request.body) : "";
  const bodyBase64 = Buffer.from(bodyText, "utf8").toString("base64");
  const command = await sandbox.runCommand({
    cmd: "node",
    args: ["local-call.mjs", method, pathWithQuery],
    cwd: WORKER_DIR,
    env: { BOOKSTUDIO_BODY_B64: bodyBase64, PORT: WORKER_PORT },
    timeoutMs: Math.min(Math.max((request.timeoutMs ?? 30_000) + 10_000, 20_000), 620_000)
  });
  const stdout = await command.stdout();
  const stderr = await command.stderr();
  if (command.exitCode !== 0) throw commandError("CODEX_SANDBOX_LOCAL_CALL_FAILED", command.exitCode, stderr);

  let envelope: LocalResponse;
  try { envelope = JSON.parse(stdout.trim()) as LocalResponse; }
  catch { throw new Error("CODEX_SANDBOX_INVALID_RESPONSE"); }
  const status = Number(envelope.status ?? 500);
  const payload = envelope.body as T & { error?: string };
  if (status < 200 || status >= 300 || payload?.error) throw new Error(payload?.error ?? `CODEX_WORKER_HTTP_${status}`);
  return payload as T;
}

async function workerHealthy(sandbox: Sandbox) {
  try {
    const health = await localRequest<{ ok?: boolean }>(sandbox, "/health", { timeoutMs: 5000 });
    return health.ok === true;
  } catch {
    return false;
  }
}

async function ensureWorkerRunning(sandbox: Sandbox) {
  if (await workerHealthy(sandbox)) return;

  await sandbox.runCommand({
    cmd: "node",
    args: ["server.mjs"],
    cwd: WORKER_DIR,
    detached: true,
    env: {
      PORT: WORKER_PORT,
      CODEX_DATA_ROOT: `${SANDBOX_ROOT}/.codex-users`,
      CODEX_WORKER_TRUST_LOCALHOST: "1",
      CODEX_WORKER_HOST: "127.0.0.1",
      CODEX_WORKER_IDLE_MS: "900000"
    }
  });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await workerHealthy(sandbox)) return;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("CODEX_SANDBOX_WORKER_START_FAILED");
}

async function acquireSandbox() {
  if (!codexSandboxSupported()) throw new Error("CODEX_SANDBOX_UNAVAILABLE");
  const sandbox = await Sandbox.getOrCreate({
    name: SANDBOX_NAME,
    source: { type: "git", url: REPOSITORY_URL, revision: "main", depth: 1 },
    runtime: "node24",
    resources: { vcpus: 1 },
    timeout: SANDBOX_TIMEOUT_MS,
    persistent: true,
    snapshotExpiration: 0,
    keepLastSnapshots: { count: 2, expiration: 0, deleteEvicted: true },
    env: {
      PORT: WORKER_PORT,
      CODEX_DATA_ROOT: `${SANDBOX_ROOT}/.codex-users`,
      CODEX_WORKER_TRUST_LOCALHOST: "1",
      CODEX_WORKER_HOST: "127.0.0.1",
      CODEX_WORKER_IDLE_MS: "900000"
    },
    resume: true,
    onCreate: async (created) => { await prepareWorkerFiles(created); },
    onResume: async (resumed) => { await prepareWorkerFiles(resumed); }
  });
  await prepareWorkerFiles(sandbox);
  await ensureWorkerRunning(sandbox);
  return sandbox;
}

async function getSandbox() {
  if (!sandboxPromise) {
    sandboxPromise = acquireSandbox().catch((error) => {
      sandboxPromise = null;
      throw error;
    });
  }
  return sandboxPromise;
}

export function codexSandboxSupported() {
  return process.env.VERCEL === "1" || Boolean(process.env.VERCEL_OIDC_TOKEN) || Boolean(
    process.env.VERCEL_TOKEN && process.env.VERCEL_TEAM_ID && process.env.VERCEL_PROJECT_ID
  );
}

export async function callCodexSandboxWorker<T>(pathWithQuery: string, request: SandboxWorkerRequest = {}): Promise<T> {
  if (!pathWithQuery.startsWith("/")) throw new Error("CODEX_WORKER_INVALID_PATH");
  try {
    const sandbox = await getSandbox();
    return await localRequest<T>(sandbox, pathWithQuery, request);
  } catch (error) {
    sandboxPromise = null;
    const message = error instanceof Error ? error.message : "CODEX_SANDBOX_UNAVAILABLE";
    if (/^(CODEX_|WORKER_|INVALID_|REQUEST_)/.test(message)) throw new Error(message);
    throw new Error("CODEX_SANDBOX_UNAVAILABLE");
  }
}
