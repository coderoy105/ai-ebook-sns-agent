import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { createServiceSupabase } from "@/lib/supabase/server";

export const SERVERLESS_CODEX_MODEL = "gpt-5.6-luna";
const require = createRequire(import.meta.url);

type JsonRpcMessage = {
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
};

type CodexAccount = {
  type?: string;
  email?: string | null;
  planType?: string | null;
};

type AccountReadResult = { account?: CodexAccount | null };
type ModelItem = { id?: string; model?: string };
type ModelListResult = { data?: ModelItem[] };
type ThreadStartResult = { thread?: { id?: string } };
type TurnStartResult = { turn?: { id?: string } };
type TurnItem = { type?: string; text?: string };
type TurnShape = { id?: string; status?: string; error?: unknown; items?: TurnItem[] };
type TurnEventParams = {
  threadId?: string;
  turnId?: string;
  turn?: TurnShape;
  delta?: string;
  tokenUsage?: { last?: { inputTokens?: number; outputTokens?: number } };
};
type TurnTerminal = { ok: boolean; params: TurnEventParams };
type LoginStartResult = { loginId?: string; verificationUrl?: string; userCode?: string };
type LoginCompletedParams = { loginId?: string; success?: boolean };

export type ServerlessCodexStatus = {
  connected: boolean;
  authMode: string | null;
  email: string | null;
  planType: string | null;
  model: string;
  modelAvailable: boolean;
  models: string[];
  rateLimits: unknown;
};

function codexEntry() {
  const packageJson = require.resolve("@openai/codex/package.json");
  return path.join(path.dirname(packageJson), "bin", "codex.js");
}

class AppServerClient {
  private nextId = 1;
  private pending = new Map<string, Pending>();
  private listeners = new Set<(message: JsonRpcMessage) => void>();
  private closed = false;

  constructor(private readonly child: ReturnType<typeof spawn>) {}

  static async start(codexHome: string) {
    const child = spawn(process.execPath, [codexEntry(), "app-server", "--listen", "stdio://"], {
      env: { ...process.env, CODEX_HOME: codexHome, NO_COLOR: "1" },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const client = new AppServerClient(child);
    const lines = readline.createInterface({ input: child.stdout! });
    lines.on("line", (line) => client.handleLine(line));
    child.once("exit", () => client.failAll(new Error("CODEX_APP_SERVER_EXITED")));
    child.once("error", () => client.failAll(new Error("CODEX_APP_SERVER_FAILED")));
    child.stderr?.on("data", () => undefined);
    await client.request("initialize", {
      clientInfo: { name: "ai-book-studio-vercel", title: "AI Book Studio Vercel", version: "1.0.0" },
      capabilities: { experimentalApi: true }
    }, 30_000);
    client.notify("initialized", {});
    return client;
  }

  private handleLine(line: string) {
    let message: JsonRpcMessage;
    try { message = JSON.parse(line) as JsonRpcMessage; } catch { return; }
    if (message.id !== undefined) {
      const key = String(message.id);
      const pending = this.pending.get(key);
      if (!pending) return;
      this.pending.delete(key);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(message.error.message ?? "CODEX_RPC_ERROR"));
      else pending.resolve(message.result);
      return;
    }
    if (typeof message.method === "string") {
      for (const listener of this.listeners) listener(message);
    }
  }

  private failAll(error: Error) {
    if (this.closed) return;
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs = 30_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error("CODEX_APP_SERVER_CLOSED"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error("CODEX_RPC_TIMEOUT"));
      }, timeoutMs);
      this.pending.set(String(id), {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      });
      this.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method: string, params?: unknown) {
    if (!this.closed) this.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  subscribe(listener: (message: JsonRpcMessage) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async stop() {
    if (this.closed) return;
    this.closed = true;
    this.child.kill("SIGTERM");
  }
}

async function loadStoredAuth(userId: string) {
  const service = createServiceSupabase();
  const { data, error } = await service.rpc<string | null>("get_codex_chatgpt_credential", { p_user_id: userId });
  if (error) throw new Error(error.message);
  return typeof data === "string" && data.trim().length > 20 ? data : null;
}

async function hasStoredAuth(userId: string) {
  const service = createServiceSupabase();
  const { data, error } = await service.rpc<boolean>("has_codex_chatgpt_credential", { p_user_id: userId });
  if (error) throw new Error(error.message);
  return data === true;
}

async function saveStoredAuth(userId: string, authJson: string, status: ServerlessCodexStatus) {
  const service = createServiceSupabase();
  const { error } = await service.rpc("store_codex_chatgpt_credential", {
    p_user_id: userId,
    p_auth_json: authJson,
    p_email: status.email,
    p_plan_type: status.planType,
    p_model_available: status.modelAvailable,
    p_rate_limits: status.rateLimits ?? null
  });
  if (error) throw new Error(error.message);
}

export async function deleteServerlessCodexCredential(userId: string) {
  const service = createServiceSupabase();
  const { error } = await service.rpc("delete_codex_chatgpt_credential", { p_user_id: userId });
  if (error) throw new Error(error.message);
}

async function prepareHome(userId: string, includeStoredAuth = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-book-codex-"));
  const home = path.join(root, "home");
  await mkdir(path.join(home, "work"), { recursive: true, mode: 0o700 });
  await writeFile(path.join(home, "config.toml"), [
    'cli_auth_credentials_store = "file"',
    "check_for_update_on_startup = false",
    `model = "${SERVERLESS_CODEX_MODEL}"`,
    ""
  ].join("\n"), { mode: 0o600 });
  if (includeStoredAuth) {
    const stored = await loadStoredAuth(userId);
    if (stored) await writeFile(path.join(home, "auth.json"), stored, { mode: 0o600 });
  }
  return { root, home };
}

async function readAuthFile(home: string) {
  try {
    const raw = await readFile(path.join(home, "auth.json"), "utf8");
    JSON.parse(raw);
    return raw;
  } catch {
    return null;
  }
}

async function inspect(client: AppServerClient): Promise<ServerlessCodexStatus> {
  const accountResponse = await client.request<AccountReadResult>("account/read", { refreshToken: true }, 30_000);
  const account = accountResponse.account ?? null;
  const authMode = account?.type === "chatgpt" ? "chatgpt" : account?.type ?? null;
  const modelResponse = authMode === "chatgpt"
    ? await client.request<ModelListResult>("model/list", { limit: 100, includeHidden: true }, 30_000)
    : { data: [] };
  const models = Array.from(new Set(
    (modelResponse.data ?? [])
      .flatMap((item) => [item.id, item.model])
      .filter((value): value is string => typeof value === "string")
  ));
  let rateLimits: unknown = null;
  if (authMode === "chatgpt") {
    try { rateLimits = await client.request("account/rateLimits/read", undefined, 30_000); }
    catch { rateLimits = null; }
  }
  return {
    connected: authMode === "chatgpt",
    authMode,
    email: account?.type === "chatgpt" ? account.email ?? null : null,
    planType: account?.type === "chatgpt" ? account.planType ?? null : null,
    model: SERVERLESS_CODEX_MODEL,
    modelAvailable: models.includes(SERVERLESS_CODEX_MODEL),
    models,
    rateLimits
  };
}

async function withClient<T>(userId: string, task: (client: AppServerClient, home: string) => Promise<T>) {
  const { root, home } = await prepareHome(userId, true);
  let client: AppServerClient | null = null;
  try {
    client = await AppServerClient.start(home);
    return await task(client, home);
  } finally {
    if (client) await client.stop().catch(() => undefined);
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function readServerlessCodexStatus(userId: string): Promise<ServerlessCodexStatus> {
  if (!(await hasStoredAuth(userId))) {
    return {
      connected: false,
      authMode: null,
      email: null,
      planType: null,
      model: SERVERLESS_CODEX_MODEL,
      modelAvailable: false,
      models: [],
      rateLimits: null
    };
  }
  try {
    return await withClient(userId, async (client, home) => {
      const status = await inspect(client);
      const authJson = await readAuthFile(home);
      if (status.connected && authJson) await saveStoredAuth(userId, authJson, status);
      return status;
    });
  } catch (error) {
    console.warn("[codex-serverless] status failed", error instanceof Error ? error.message : error);
    return {
      connected: false,
      authMode: null,
      email: null,
      planType: null,
      model: SERVERLESS_CODEX_MODEL,
      modelAvailable: false,
      models: [],
      rateLimits: null
    };
  }
}

function usageFromTokenNotification(params: TurnEventParams) {
  const last = params.tokenUsage?.last;
  return {
    inputTokens: Number(last?.inputTokens ?? 0),
    outputTokens: Number(last?.outputTokens ?? 0)
  };
}

export async function generateServerlessCodexStructured<T>(userId: string, input: {
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  system: string;
  prompt: string;
  timeoutMs?: number;
  parse: (value: unknown) => T;
}) {
  if (!(await hasStoredAuth(userId))) throw new Error("CODEX_CONNECTION_REQUIRED");
  return withClient(userId, async (client, home) => {
    const started = Date.now();
    const snapshot = await inspect(client);
    if (!snapshot.connected) throw new Error("CODEX_CONNECTION_REQUIRED");
    if (!snapshot.modelAvailable) throw new Error("CODEX_LUNA_UNAVAILABLE");

    const threadResult = await client.request<ThreadStartResult>("thread/start", {
      model: SERVERLESS_CODEX_MODEL,
      cwd: path.join(home, "work"),
      approvalPolicy: "never",
      sandbox: "read-only",
      developerInstructions: input.system,
      ephemeral: true
    }, 60_000);
    const threadId = threadResult.thread?.id;
    if (!threadId) throw new Error("CODEX_THREAD_START_FAILED");

    let turnId: string | null = null;
    let text = "";
    let tokenUsage = { inputTokens: 0, outputTokens: 0 };
    let finish: ((value: TurnTerminal) => void) | null = null;
    const terminalPromise = new Promise<TurnTerminal>((resolve) => { finish = resolve; });
    const unsubscribe = client.subscribe((message) => {
      const params = (message.params ?? {}) as TurnEventParams;
      if (params.threadId !== threadId) return;
      if (turnId && params.turnId && params.turnId !== turnId && params.turn?.id !== turnId) return;
      if (message.method === "item/agentMessage/delta" && typeof params.delta === "string") text += params.delta;
      if (message.method === "thread/tokenUsage/updated") tokenUsage = usageFromTokenNotification(params);
      if (message.method === "turn/completed") finish?.({ ok: params.turn?.status === "completed", params });
    });

    let timeoutHandle: NodeJS.Timeout | null = null;
    try {
      const turnResult = await client.request<TurnStartResult>("turn/start", {
        threadId,
        input: [{ type: "text", text: input.prompt, textElements: [] }],
        model: SERVERLESS_CODEX_MODEL,
        outputSchema: input.jsonSchema,
        sandboxPolicy: { type: "readOnly", networkAccess: false },
        approvalPolicy: "never"
      }, 60_000);
      turnId = turnResult.turn?.id ?? null;
      if (!turnId) throw new Error("CODEX_TURN_START_FAILED");

      const timeoutMs = Math.min(Math.max(Number(input.timeoutMs ?? 220_000), 10_000), 240_000);
      const timeout = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error("CODEX_GENERATION_TIMEOUT")), timeoutMs);
      });
      const completed = await Promise.race([terminalPromise, timeout]);
      if (!completed.ok) {
        const errorText = JSON.stringify(completed.params.turn?.error ?? "");
        if (/rate.?limit|usage.?limit|quota/i.test(errorText)) throw new Error("CODEX_USAGE_LIMIT");
        throw new Error("CODEX_GENERATION_FAILED");
      }
      if (!text.trim()) {
        const items = completed.params.turn?.items ?? [];
        const agent = [...items].reverse().find((item) => item.type === "agentMessage" || item.type === "agent_message");
        text = typeof agent?.text === "string" ? agent.text : "";
      }
      let value: unknown;
      try { value = JSON.parse(text); }
      catch { throw new Error("CODEX_INVALID_JSON"); }

      const refreshedAuth = await readAuthFile(home);
      if (refreshedAuth) await saveStoredAuth(userId, refreshedAuth, snapshot);
      return {
        value: input.parse(value),
        usage: {
          ...tokenUsage,
          durationMs: Date.now() - started,
          model: SERVERLESS_CODEX_MODEL,
          requestId: turnId ?? undefined
        }
      };
    } finally {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      unsubscribe();
    }
  });
}

export async function startServerlessCodexLoginStream(userId: string) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
      const { root, home } = await prepareHome(userId, true);
      let client: AppServerClient | null = null;
      let unsubscribe: (() => void) | null = null;
      try {
        client = await AppServerClient.start(home);
        const current = await inspect(client).catch(() => null);
        if (current?.connected) {
          const authJson = await readAuthFile(home);
          if (authJson) await saveStoredAuth(userId, authJson, current);
          send({ type: "connected", ...current });
          controller.close();
          return;
        }

        const login = await client.request<LoginStartResult>("account/login/start", { type: "chatgptDeviceCode" }, 60_000);
        if (!login.loginId || !login.verificationUrl || !login.userCode) throw new Error("CODEX_DEVICE_CODE_START_FAILED");
        send({ type: "device_code", loginId: login.loginId, verificationUrl: login.verificationUrl, userCode: login.userCode });

        let completedResolve: ((value: boolean) => void) | null = null;
        const completed = new Promise<boolean>((resolve) => { completedResolve = resolve; });
        unsubscribe = client.subscribe((message) => {
          if (message.method !== "account/login/completed") return;
          const params = (message.params ?? {}) as LoginCompletedParams;
          if (params.loginId && params.loginId !== login.loginId) return;
          completedResolve?.(params.success !== false);
        });
        const success = await Promise.race([
          completed,
          new Promise<boolean>((_, reject) => setTimeout(() => reject(new Error("CODEX_LOGIN_DID_NOT_COMPLETE")), 270_000))
        ]);
        if (!success) throw new Error("CODEX_LOGIN_FAILED");

        const status = await inspect(client);
        const authJson = await readAuthFile(home);
        if (!status.connected || !authJson) throw new Error("CODEX_LOGIN_CREDENTIAL_MISSING");
        await saveStoredAuth(userId, authJson, status);
        send({ type: "connected", ...status });
        controller.close();
      } catch (error) {
        send({ type: "error", error: error instanceof Error ? error.message : "CODEX_LOGIN_FAILED" });
        controller.close();
      } finally {
        unsubscribe?.();
        if (client) await client.stop().catch(() => undefined);
        await rm(root, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no"
    }
  });
}
