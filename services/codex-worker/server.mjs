import http from "node:http";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const require = createRequire(import.meta.url);
const PORT = Number(process.env.PORT ?? 8787);
const DATA_ROOT = path.resolve(process.env.CODEX_DATA_ROOT ?? "/data/codex-users");
const SHARED_SECRET = process.env.CODEX_WORKER_SHARED_SECRET?.trim() ?? "";
const CLOCK_SKEW_MS = Number(process.env.CODEX_WORKER_CLOCK_SKEW_MS ?? 120000);
const IDLE_MS = Number(process.env.CODEX_WORKER_IDLE_MS ?? 900000);
const MODEL = "gpt-5.6-luna";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (SHARED_SECRET.length < 32) throw new Error("CODEX_WORKER_SHARED_SECRET must be at least 32 characters.");

function codexEntry() {
  const packageJson = require.resolve("@openai/codex/package.json");
  return path.join(path.dirname(packageJson), "bin", "codex.js");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function userHome(userId) {
  if (!UUID_RE.test(userId)) throw new Error("INVALID_USER_ID");
  const key = sha256(userId);
  const home = path.resolve(DATA_ROOT, key);
  if (!home.startsWith(`${DATA_ROOT}${path.sep}`)) throw new Error("INVALID_USER_HOME");
  return home;
}

async function ensureHome(userId) {
  const home = userHome(userId);
  await mkdir(home, { recursive: true, mode: 0o700 });
  await mkdir(path.join(home, "work"), { recursive: true, mode: 0o700 });
  await writeFile(path.join(home, "config.toml"), [
    'cli_auth_credentials_store = "file"',
    "check_for_update_on_startup = false",
    `model = "${MODEL}"`,
    ""
  ].join("\n"), { mode: 0o600 });
  return home;
}

class AppServerClient {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.closed = false;
  }

  static async start(codexHome) {
    const child = spawn(process.execPath, [codexEntry(), "app-server", "--listen", "stdio://"], {
      env: { ...process.env, CODEX_HOME: codexHome, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const client = new AppServerClient(child);
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => client.handleLine(line));
    child.once("exit", () => client.failAll(new Error("CODEX_APP_SERVER_EXITED")));
    child.once("error", () => client.failAll(new Error("CODEX_APP_SERVER_FAILED")));
    child.stderr.resume();
    await client.request("initialize", {
      clientInfo: { name: "ai-book-studio-worker", title: "AI Book Studio Worker", version: "1.0.0" },
      capabilities: { experimentalApi: true }
    }, 30000);
    client.notify("initialized", {});
    return client;
  }

  handleLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (Object.prototype.hasOwnProperty.call(message, "id")) {
      const pending = this.pending.get(String(message.id));
      if (!pending) return;
      this.pending.delete(String(message.id));
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message ?? "CODEX_RPC_ERROR"));
      else pending.resolve(message.result);
      return;
    }
    if (typeof message.method === "string") {
      for (const listener of this.listeners) listener(message);
    }
  }

  failAll(error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  request(method, params, timeoutMs = 30000) {
    if (this.closed) return Promise.reject(new Error("CODEX_APP_SERVER_CLOSED"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error("CODEX_RPC_TIMEOUT"));
      }, timeoutMs);
      this.pending.set(String(id), { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method, params) {
    if (!this.closed) this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async stop() {
    if (this.closed) return;
    this.closed = true;
    this.child.kill("SIGTERM");
  }
}

const sessions = new Map();
const locks = new Map();
const seenNonces = new Map();
const rateWindows = new Map();

async function withUserLock(userId, task) {
  const previous = locks.get(userId) ?? Promise.resolve();
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  const queued = previous.then(() => barrier);
  locks.set(userId, queued);
  await previous;
  try { return await task(); }
  finally {
    release();
    if (locks.get(userId) === queued) locks.delete(userId);
  }
}

async function sessionFor(userId) {
  let session = sessions.get(userId);
  if (session?.client && !session.client.closed) {
    session.lastUsed = Date.now();
    return session;
  }
  const home = await ensureHome(userId);
  const client = await AppServerClient.start(home);
  session = { home, client, lastUsed: Date.now(), pendingLoginId: null };
  sessions.set(userId, session);
  return session;
}

async function stopSession(userId) {
  const session = sessions.get(userId);
  sessions.delete(userId);
  if (session) await session.client.stop().catch(() => undefined);
}

setInterval(() => {
  const cutoff = Date.now() - IDLE_MS;
  for (const [userId, session] of sessions) {
    if (session.lastUsed < cutoff && !session.pendingLoginId) void stopSession(userId);
  }
  for (const [nonce, expiresAt] of seenNonces) if (expiresAt < Date.now()) seenNonces.delete(nonce);
}, 60000).unref();

function safeEqualHex(a, b) {
  if (!/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function verifyRequest(req, pathWithQuery, bodyText) {
  const timestamp = req.headers["x-bookstudio-timestamp"];
  const nonce = req.headers["x-bookstudio-nonce"];
  const supplied = req.headers["x-bookstudio-signature"];
  if (typeof timestamp !== "string" || typeof nonce !== "string" || typeof supplied !== "string") return false;
  const when = Number(timestamp);
  if (!Number.isFinite(when) || Math.abs(Date.now() - when) > CLOCK_SKEW_MS) return false;
  if (!/^[0-9a-f-]{20,80}$/i.test(nonce) || seenNonces.has(nonce)) return false;
  const bodyHash = sha256(bodyText);
  const canonical = `${timestamp}\n${nonce}\n${req.method}\n${pathWithQuery}\n${bodyHash}`;
  const expected = createHmac("sha256", SHARED_SECRET).update(canonical).digest("hex");
  if (!safeEqualHex(expected, supplied)) return false;
  seenNonces.set(nonce, Date.now() + CLOCK_SKEW_MS * 2);
  return true;
}

function assertRate(userId, route) {
  const key = `${userId}:${route}`;
  const now = Date.now();
  const windowMs = route === "/generate" ? 3600000 : 60000;
  const limit = route === "/generate" ? 60 : 120;
  const current = rateWindows.get(key);
  if (!current || current.startedAt + windowMs <= now) {
    rateWindows.set(key, { startedAt: now, count: 1 });
    return;
  }
  current.count += 1;
  if (current.count > limit) throw new Error("WORKER_RATE_LIMITED");
}

async function inspect(client) {
  const accountResponse = await client.request("account/read", { refreshToken: true }, 30000);
  const account = accountResponse?.account ?? null;
  const authMode = account?.type === "chatgpt" ? "chatgpt" : account?.type ?? null;
  const modelResponse = authMode === "chatgpt"
    ? await client.request("model/list", { limit: 100, includeHidden: true }, 30000)
    : { data: [] };
  const models = Array.from(new Set((modelResponse?.data ?? []).flatMap((item) => [item?.id, item?.model]).filter((value) => typeof value === "string")));
  let rateLimits = null;
  if (authMode === "chatgpt") {
    try { rateLimits = await client.request("account/rateLimits/read", undefined, 30000); }
    catch { rateLimits = null; }
  }
  return {
    connected: authMode === "chatgpt",
    authMode,
    email: account?.type === "chatgpt" ? account.email ?? null : null,
    planType: account?.type === "chatgpt" ? account.planType ?? null : null,
    model: MODEL,
    modelAvailable: models.includes(MODEL),
    models,
    rateLimits
  };
}

async function startLogin(userId) {
  return withUserLock(userId, async () => {
    const session = await sessionFor(userId);
    const current = await inspect(session.client).catch(() => null);
    if (current?.connected) return { type: "already_connected", ...current };
    const login = await session.client.request("account/login/start", { type: "chatgptDeviceCode" }, 60000);
    if (!login?.loginId || !login?.verificationUrl || !login?.userCode) throw new Error("CODEX_DEVICE_CODE_START_FAILED");
    session.pendingLoginId = login.loginId;
    const unsubscribe = session.client.subscribe((message) => {
      if (message.method !== "account/login/completed") return;
      if (message.params?.loginId && message.params.loginId !== login.loginId) return;
      session.pendingLoginId = null;
      unsubscribe();
    });
    return {
      type: "chatgptDeviceCode",
      loginId: login.loginId,
      verificationUrl: login.verificationUrl,
      userCode: login.userCode
    };
  });
}

async function logout(userId) {
  return withUserLock(userId, async () => {
    const session = await sessionFor(userId).catch(() => null);
    if (session) await session.client.request("account/logout", undefined, 30000).catch(() => undefined);
    await stopSession(userId);
    await rm(userHome(userId), { recursive: true, force: true });
    return { connected: false };
  });
}

function usageFromTokenNotification(params) {
  const last = params?.tokenUsage?.last;
  return {
    inputTokens: Number(last?.inputTokens ?? 0),
    outputTokens: Number(last?.outputTokens ?? 0)
  };
}

async function generate(userId, input) {
  return withUserLock(userId, async () => {
    const started = Date.now();
    const session = await sessionFor(userId);
    const snapshot = await inspect(session.client);
    if (!snapshot.connected) throw new Error("CODEX_CONNECTION_REQUIRED");
    if (!snapshot.modelAvailable) throw new Error("CODEX_LUNA_UNAVAILABLE");
    if (input.model !== MODEL) throw new Error("CODEX_MODEL_NOT_ALLOWED");

    const threadResult = await session.client.request("thread/start", {
      model: MODEL,
      cwd: path.join(session.home, "work"),
      approvalPolicy: "never",
      sandbox: "read-only",
      developerInstructions: input.system,
      ephemeral: true
    }, 60000);
    const threadId = threadResult?.thread?.id;
    if (!threadId) throw new Error("CODEX_THREAD_START_FAILED");

    let turnId = null;
    let text = "";
    let tokenUsage = { inputTokens: 0, outputTokens: 0 };
    let terminal = null;
    let timeoutHandle = null;
    const terminalPromise = new Promise((resolve) => { terminal = resolve; });
    const unsubscribe = session.client.subscribe((message) => {
      const params = message.params ?? {};
      if (params.threadId !== threadId) return;
      if (turnId && params.turnId && params.turnId !== turnId && params.turn?.id !== turnId) return;
      if (message.method === "item/agentMessage/delta" && typeof params.delta === "string") text += params.delta;
      if (message.method === "thread/tokenUsage/updated") tokenUsage = usageFromTokenNotification(params);
      if (message.method === "turn/completed") terminal({ ok: params.turn?.status === "completed", params });
    });

    try {
      const turnResult = await session.client.request("turn/start", {
        threadId,
        input: [{ type: "text", text: input.prompt, textElements: [] }],
        model: MODEL,
        outputSchema: input.jsonSchema,
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        approvalPolicy: "never"
      }, 60000);
      turnId = turnResult?.turn?.id;
      if (!turnId) throw new Error("CODEX_TURN_START_FAILED");
      const timeoutMs = Math.min(Math.max(Number(input.timeoutMs ?? 240000), 10000), 600000);
      const timeout = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error("CODEX_GENERATION_TIMEOUT")), timeoutMs);
      });
      const completed = await Promise.race([terminalPromise, timeout]);
      if (!completed?.ok) {
        const errorText = JSON.stringify(completed?.params?.turn?.error ?? "");
        if (/rate.?limit|usage.?limit|quota/i.test(errorText)) throw new Error("CODEX_USAGE_LIMIT");
        throw new Error("CODEX_GENERATION_FAILED");
      }
      if (!text.trim()) {
        const items = completed.params?.turn?.items ?? [];
        const agent = [...items].reverse().find((item) => item?.type === "agentMessage" || item?.type === "agent_message");
        text = typeof agent?.text === "string" ? agent.text : "";
      }
      let value;
      try { value = JSON.parse(text); }
      catch { throw new Error("CODEX_INVALID_JSON"); }
      session.lastUsed = Date.now();
      return {
        value,
        usage: {
          ...tokenUsage,
          durationMs: Date.now() - started,
          model: MODEL,
          requestId: turnId
        }
      };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      unsubscribe();
    }
  });
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2 * 1024 * 1024) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function publicError(error) {
  const message = error instanceof Error ? error.message : "WORKER_ERROR";
  const allowed = /^(CODEX_|WORKER_|INVALID_|REQUEST_)/.test(message);
  return allowed ? message : "WORKER_ERROR";
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://worker.local");
  if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ok: true, service: "codex-oauth-worker", modelCandidate: MODEL });

  let bodyText = "";
  try {
    bodyText = await readBody(req);
    const pathWithQuery = `${url.pathname}${url.search}`;
    if (!verifyRequest(req, pathWithQuery, bodyText)) return json(res, 401, { error: "WORKER_UNAUTHORIZED" });
    const body = bodyText ? JSON.parse(bodyText) : {};
    const userId = typeof body.userId === "string" ? body.userId : url.searchParams.get("userId") ?? "";
    if (!UUID_RE.test(userId)) return json(res, 400, { error: "INVALID_USER_ID" });
    assertRate(userId, url.pathname);

    if (req.method === "POST" && url.pathname === "/auth/start") return json(res, 200, await startLogin(userId));
    if (req.method === "GET" && url.pathname === "/auth/status") {
      const session = await sessionFor(userId);
      const snapshot = await inspect(session.client);
      if (snapshot.connected) session.pendingLoginId = null;
      return json(res, 200, snapshot);
    }
    if (req.method === "POST" && url.pathname === "/auth/logout") return json(res, 200, await logout(userId));
    if (req.method === "GET" && url.pathname === "/models") {
      const snapshot = await inspect((await sessionFor(userId)).client);
      return json(res, 200, { model: MODEL, modelAvailable: snapshot.modelAvailable, models: snapshot.models });
    }
    if (req.method === "GET" && url.pathname === "/usage") {
      const snapshot = await inspect((await sessionFor(userId)).client);
      return json(res, 200, { planType: snapshot.planType, rateLimits: snapshot.rateLimits });
    }
    if (req.method === "POST" && url.pathname === "/generate") return json(res, 200, await generate(userId, body));
    return json(res, 404, { error: "WORKER_ROUTE_NOT_FOUND" });
  } catch (error) {
    const code = publicError(error);
    const status = code === "WORKER_RATE_LIMITED" || code === "CODEX_USAGE_LIMIT" ? 429 : code === "CODEX_CONNECTION_REQUIRED" ? 428 : 400;
    return json(res, status, { error: code });
  }
});

await mkdir(DATA_ROOT, { recursive: true, mode: 0o700 });
server.listen(PORT, "0.0.0.0");
