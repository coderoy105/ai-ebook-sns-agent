import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

export const CODEX_LUNA_MODEL = "gpt-5.6-luna";
const require = createRequire(import.meta.url);

type JsonObject = Record<string, unknown>;
type RpcResponse = { id?: number | string; result?: unknown; error?: { message?: string } };
type Notification = { method?: string; params?: unknown };
type CodexEnv = NodeJS.ProcessEnv & Record<string, string>;

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type NotificationWaiter = {
  method: string;
  predicate?: (params: unknown) => boolean;
  resolve: (params: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

function envWithCodexHome(codexHome: string): CodexEnv {
  const rawNodeEnv = process.env.NODE_ENV;
  const nodeEnv = rawNodeEnv === "development" || rawNodeEnv === "test" || rawNodeEnv === "production" ? rawNodeEnv : "production";
  const env = { NODE_ENV: nodeEnv } as CodexEnv;
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  env.NODE_ENV = nodeEnv;
  env.CODEX_HOME = codexHome;
  env.NO_COLOR = "1";
  return env;
}

export function resolveCodexCliEntry() {
  const packageJson = require.resolve("@openai/codex/package.json");
  return join(dirname(packageJson), "bin", "codex.js");
}

export async function createEphemeralCodexHome(authJson?: string | null) {
  const dir = await mkdtemp(join(tmpdir(), "ai-book-codex-"));
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "config.toml"),
    [
      'cli_auth_credentials_store = "file"',
      "check_for_update_on_startup = false",
      `model = "${CODEX_LUNA_MODEL}"`,
      ""
    ].join("\n"),
    { mode: 0o600 }
  );
  if (authJson) {
    JSON.parse(authJson);
    await writeFile(join(dir, "auth.json"), authJson, { mode: 0o600 });
  }
  return {
    dir,
    env: envWithCodexHome(dir),
    async readAuthJson() {
      return readFile(join(dir, "auth.json"), "utf8");
    },
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    }
  };
}

export class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number | string, Pending>();
  private waiters = new Set<NotificationWaiter>();
  private stderr = "";

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    const lines = createInterface({ input: child.stdout });
    lines.on("line", (line) => this.handleLine(line));
    child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-12000);
    });
    child.once("exit", (code, signal) => {
      const error = new Error(`CODEX_APP_SERVER_EXITED:${code ?? "null"}:${signal ?? "none"}:${this.stderr.slice(-1200)}`);
      for (const item of this.pending.values()) item.reject(error);
      this.pending.clear();
      for (const waiter of this.waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
      this.waiters.clear();
    });
  }

  static async start(codexHome: string) {
    const child = spawn(process.execPath, [resolveCodexCliEntry(), "app-server", "--listen", "stdio://"], {
      env: envWithCodexHome(codexHome),
      stdio: ["pipe", "pipe", "pipe"]
    });
    const client = new CodexAppServerClient(child);
    await client.request("initialize", {
      clientInfo: { name: "ai_book_studio", title: "AI Book Studio", version: "0.1.0" }
    });
    client.notify("initialized", {});
    return client;
  }

  private handleLine(line: string) {
    let message: RpcResponse & Notification;
    try {
      message = JSON.parse(line) as RpcResponse & Notification;
    } catch {
      return;
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? "CODEX_RPC_FAILED"));
      else pending.resolve(message.result);
      return;
    }

    if (!message.method) return;
    for (const waiter of [...this.waiters]) {
      if (waiter.method !== message.method) continue;
      if (waiter.predicate && !waiter.predicate(message.params)) continue;
      clearTimeout(waiter.timer);
      this.waiters.delete(waiter);
      waiter.resolve(message.params);
    }
  }

  request(method: string, params?: JsonObject, timeoutMs = 30000): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CODEX_RPC_TIMEOUT:${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      this.child.stdin.write(`${JSON.stringify({ method, id, params: params ?? {} })}\n`);
    });
  }

  notify(method: string, params?: JsonObject) {
    this.child.stdin.write(`${JSON.stringify({ method, params: params ?? {} })}\n`);
  }

  waitForNotification(method: string, predicate?: (params: unknown) => boolean, timeoutMs = 240000) {
    return new Promise<unknown>((resolve, reject) => {
      const waiter: NotificationWaiter = {
        method,
        predicate,
        resolve,
        reject,
        timer: setTimeout(() => {
          this.waiters.delete(waiter);
          reject(new Error(`CODEX_NOTIFICATION_TIMEOUT:${method}`));
        }, timeoutMs)
      };
      this.waiters.add(waiter);
    });
  }

  async stop() {
    if (!this.child.killed) this.child.kill("SIGTERM");
  }
}

export type CodexAccountSnapshot = {
  authMode: string | null;
  email: string | null;
  planType: string | null;
  modelAvailable: boolean;
  models: string[];
  rateLimits: unknown;
};

export async function inspectCodexAccount(client: CodexAppServerClient): Promise<CodexAccountSnapshot> {
  const accountResult = await client.request("account/read", { refreshToken: true }, 45000) as {
    account?: { type?: string; email?: string | null; planType?: string | null } | null;
    authMode?: string | null;
  } | null;

  const modelResult = await client.request("model/list", { limit: 100, includeHidden: true }, 45000) as {
    data?: Array<{ id?: string; model?: string; displayName?: string }>;
  } | null;
  const models = (modelResult?.data ?? [])
    .flatMap((item) => [item.model, item.id].filter((value): value is string => typeof value === "string"));

  let rateLimits: unknown = null;
  try {
    const limits = await client.request("account/rateLimits/read", {}, 30000) as { rateLimits?: unknown } | null;
    rateLimits = limits?.rateLimits ?? limits ?? null;
  } catch {
    rateLimits = null;
  }

  return {
    authMode: accountResult?.authMode ?? accountResult?.account?.type ?? null,
    email: accountResult?.account?.email ?? null,
    planType: accountResult?.account?.planType ?? null,
    modelAvailable: models.some((model) => model === CODEX_LUNA_MODEL),
    models: [...new Set(models)].slice(0, 100),
    rateLimits
  };
}
