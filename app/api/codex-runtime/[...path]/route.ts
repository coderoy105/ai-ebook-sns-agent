import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyVercelOidcToken } from "@vercel/oidc";
import {
  callCodexWorker,
  codexWorkerConfigured,
  generateCodexWorkerStructured,
  readCodexWorkerStatus
} from "@/lib/ai/codex-worker";
import { CODEX_LUNA_MODEL } from "@/lib/ai/codex-constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UserSchema = z.object({ userId: z.string().uuid() });
const GenerateSchema = UserSchema.extend({
  schemaName: z.string().min(1).max(120),
  jsonSchema: z.record(z.string(), z.unknown()),
  system: z.string().min(1).max(30000),
  prompt: z.string().min(1).max(120000),
  timeoutMs: z.number().int().min(10000).max(240000).optional()
});

function describeError(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 1600);
  if (value instanceof Error) {
    const causeDetail: string = value.cause == null ? "" : `:${describeError(value.cause)}`;
    return `${value.message || value.name}${causeDetail}`.slice(0, 1600);
  }
  try {
    const record = value as Record<string, unknown>;
    const compact = Object.fromEntries(["name", "message", "code", "status", "statusCode", "error", "details"]
      .filter((key) => record && key in record)
      .map((key) => [key, record[key]]));
    const text = JSON.stringify(compact);
    return text && text !== "{}" ? text.slice(0, 1600) : String(value).slice(0, 1600);
  } catch {
    return String(value).slice(0, 1600);
  }
}

async function assertProjectOidc(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw new Error("INTERNAL_UNAUTHORIZED");
  try {
    await verifyVercelOidcToken(token);
  } catch {
    throw new Error("INTERNAL_UNAUTHORIZED");
  }
}

function errorStatus(message: string) {
  if (message === "INTERNAL_UNAUTHORIZED") return 401;
  if (message.startsWith("CODEX_WORKER_UNAVAILABLE") || message.startsWith("CODEX_SANDBOX_")) return 503;
  if (message.startsWith("CODEX_USAGE_LIMIT")) return 429;
  return 400;
}

export async function POST(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  try {
    await assertProjectOidc(request);
    if (!codexWorkerConfigured()) throw new Error("CODEX_WORKER_UNAVAILABLE");
    const path = (await params).path ?? [];
    const action = path[0] ?? "";

    if (action === "status") {
      const { userId } = UserSchema.parse(await request.json());
      return NextResponse.json(await readCodexWorkerStatus(userId));
    }

    if (action === "start") {
      const { userId } = UserSchema.parse(await request.json());
      const result = await callCodexWorker<Record<string, unknown>>("/auth/start", {
        method: "POST",
        body: { userId },
        timeoutMs: 60000
      });
      return NextResponse.json(result);
    }

    if (action === "logout") {
      const { userId } = UserSchema.parse(await request.json());
      await callCodexWorker("/auth/logout", { method: "POST", body: { userId }, timeoutMs: 60000 });
      return NextResponse.json({ connected: false });
    }

    if (action === "generate") {
      const input = GenerateSchema.parse(await request.json());
      const result = await generateCodexWorkerStructured(input.userId, {
        schemaName: input.schemaName,
        jsonSchema: input.jsonSchema,
        system: input.system,
        prompt: input.prompt,
        timeoutMs: input.timeoutMs,
        parse: (value) => value
      });
      return NextResponse.json({ ...result, model: CODEX_LUNA_MODEL });
    }

    return NextResponse.json({ error: "CODEX_RUNTIME_ROUTE_NOT_FOUND" }, { status: 404 });
  } catch (error) {
    const message = describeError(error) || "CODEX_RUNTIME_FAILED";
    return NextResponse.json({ error: message }, { status: errorStatus(message) });
  }
}
