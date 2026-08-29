from pathlib import Path
import json

pkg_path = Path("package.json")
pkg = json.loads(pkg_path.read_text())
pkg["dependencies"]["@vercel/sandbox"] = "3.2.1"
pkg["dependencies"] = dict(sorted(pkg["dependencies"].items()))
pkg_path.write_text(json.dumps(pkg, ensure_ascii=False, indent=2) + "\n")

Path("lib/ai/codex-sandbox.ts").write_text(r'''import { Sandbox } from "@vercel/sandbox";

const SANDBOX_NAME = "ai-book-studio-codex-runtime-v1";
const REPOSITORY_URL = "https://github.com/coderoy105/ai-ebook-sns-agent.git";
const SANDBOX_ROOT = "/vercel/sandbox";
const WORKER_DIR = `${SANDBOX_ROOT}/services/codex-worker`;
const VERSION_FILE = `${SANDBOX_ROOT}/.ai-book-codex-worker-version`;
const WORKER_VERSION = "2026-08-29-sandbox-runtime-v1";
const SANDBOX_TIMEOUT_MS = 44 * 60 * 1000;
const WORKER_PORT = "8787";

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

  for (let attempt = 0; attempt < 15; attempt += 1) {
    if (await workerHealthy(sandbox)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
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

export async function probeCodexSandbox() {
  const probeUser = "00000000-0000-4000-8000-000000000001";
  const health = await callCodexSandboxWorker<{ ok?: boolean; modelCandidate?: string }>("/health", { timeoutMs: 10_000 });
  let deviceCode = false;
  try {
    const started = await callCodexSandboxWorker<{ type?: string }>("/auth/start", {
      method: "POST",
      body: { userId: probeUser },
      timeoutMs: 60_000
    });
    deviceCode = started.type === "chatgptDeviceCode" || started.type === "already_connected";
  } finally {
    await callCodexSandboxWorker("/auth/logout", { method: "POST", body: { userId: probeUser }, timeoutMs: 30_000 }).catch(() => undefined);
  }
  return { ok: health.ok === true && deviceCode, worker: health.ok === true, deviceCode, modelCandidate: health.modelCandidate ?? null };
}
''')

Path("services/codex-worker/local-call.mjs").write_text(r'''const method = process.argv[2] ?? "GET";
const pathWithQuery = process.argv[3] ?? "/health";
const bodyText = Buffer.from(process.env.BOOKSTUDIO_BODY_B64 ?? "", "base64").toString("utf8");

try {
  const response = await fetch(`http://127.0.0.1:${process.env.PORT ?? "8787"}${pathWithQuery}`, {
    method,
    headers: bodyText ? { "content-type": "application/json" } : undefined,
    body: bodyText || undefined
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { error: text || `CODEX_WORKER_HTTP_${response.status}` }; }
  process.stdout.write(JSON.stringify({ status: response.status, body }));
} catch (error) {
  process.stderr.write(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
''')

worker = Path("services/codex-worker/server.mjs")
s = worker.read_text()
if "CODEX_WORKER_TRUST_LOCALHOST" not in s:
    s = s.replace('const SHARED_SECRET = process.env.CODEX_WORKER_SHARED_SECRET?.trim() ?? "";\n', 'const SHARED_SECRET = process.env.CODEX_WORKER_SHARED_SECRET?.trim() ?? "";\nconst TRUST_LOCALHOST = process.env.CODEX_WORKER_TRUST_LOCALHOST === "1";\nconst LISTEN_HOST = process.env.CODEX_WORKER_HOST?.trim() || "0.0.0.0";\n')
    s = s.replace('if (SHARED_SECRET.length < 32) throw new Error("CODEX_WORKER_SHARED_SECRET must be at least 32 characters.");', 'if (!TRUST_LOCALHOST && SHARED_SECRET.length < 32) throw new Error("CODEX_WORKER_SHARED_SECRET must be at least 32 characters.");')
    marker = "function verifyRequest(req, pathWithQuery, bodyText) {"
    insertion = '''function isLoopbackRequest(req) {\n  const address = req.socket?.remoteAddress ?? "";\n  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";\n}\n\n'''
    s = s.replace(marker, insertion + marker)
    s = s.replace('    if (!verifyRequest(req, pathWithQuery, bodyText)) return json(res, 401, { error: "WORKER_UNAUTHORIZED" });', '    const trustedLocal = TRUST_LOCALHOST && isLoopbackRequest(req);\n    if (!trustedLocal && !verifyRequest(req, pathWithQuery, bodyText)) return json(res, 401, { error: "WORKER_UNAUTHORIZED" });')
    s = s.replace('server.listen(PORT, "0.0.0.0");', 'server.listen(PORT, LISTEN_HOST);')
worker.write_text(s)

codex = Path("lib/ai/codex-worker.ts")
c = codex.read_text()
if 'from "@/lib/ai/codex-sandbox"' not in c:
    c = 'import { callCodexSandboxWorker, codexSandboxSupported } from "@/lib/ai/codex-sandbox";\n' + c
c = c.replace('  return Boolean(baseUrl && secret.length >= 32);', '  return Boolean(baseUrl && secret.length >= 32) || codexSandboxSupported();')
old = '''export async function callCodexWorker<T>(pathWithQuery: string, request: WorkerRequest = {}): Promise<T> {\n  const { baseUrl, secret } = workerConfig();\n  if (!baseUrl || secret.length < 32) throw new Error("CODEX_WORKER_UNAVAILABLE");\n  if (!pathWithQuery.startsWith("/")) throw new Error("CODEX_WORKER_INVALID_PATH");'''
new = '''export async function callCodexWorker<T>(pathWithQuery: string, request: WorkerRequest = {}): Promise<T> {\n  const { baseUrl, secret } = workerConfig();\n  if (!baseUrl || secret.length < 32) {\n    if (codexSandboxSupported()) return callCodexSandboxWorker<T>(pathWithQuery, request);\n    throw new Error("CODEX_WORKER_UNAVAILABLE");\n  }\n  if (!pathWithQuery.startsWith("/")) throw new Error("CODEX_WORKER_INVALID_PATH");'''
if old in c:
    c = c.replace(old, new)
elif 'return callCodexSandboxWorker<T>(pathWithQuery, request);' not in c:
    raise SystemExit("callCodexWorker anchor not found")
codex.write_text(c)

route = Path("app/api/core/[...path]/route.ts")
r = route.read_text()
import_anchor = 'import { handleCodexGenerationBridge } from "@/lib/ai/codex-internal";'
if 'probeCodexSandbox' not in r:
    if import_anchor not in r:
        raise SystemExit("route import anchor not found")
    r = r.replace(import_anchor, import_anchor + '\nimport { probeCodexSandbox } from "@/lib/ai/codex-sandbox";')
    health_anchor = "async function handleHealth() {"
    idx = r.index(health_anchor)
    probe_fn = '''async function handleCodexSandboxProbe() {\n  try {\n    return NextResponse.json(await probeCodexSandbox(), { status: 200, headers: { "cache-control": "no-store" } });\n  } catch (error) {\n    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "CODEX_SANDBOX_PROBE_FAILED" }, { status: 503, headers: { "cache-control": "no-store" } });\n  }\n}\n\n'''
    r = r[:idx] + probe_fn + r[idx:]
    get_anchor = '  if (path[0] === "health" && path[1] === "service-bridge") return handleHealth();'
    r = r.replace(get_anchor, get_anchor + '\n  if (path[0] === "health" && path[1] === "codex-sandbox-probe-72f46d0e") return handleCodexSandboxProbe();')
route.write_text(r)
