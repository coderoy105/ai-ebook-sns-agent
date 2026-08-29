import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyVercelOidcToken } from "@vercel/oidc";
import { generateCodexWorkerStructured } from "@/lib/ai/codex-worker";

const Schema = z.object({
  userId: z.string().uuid(),
  schemaName: z.string().min(1).max(120),
  jsonSchema: z.record(z.string(), z.unknown()),
  system: z.string().min(1).max(30000),
  prompt: z.string().min(1).max(120000),
  timeoutMs: z.number().int().min(10000).max(240000).optional()
});

async function assertProjectOidc(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) throw new Error("INTERNAL_UNAUTHORIZED");
  try { await verifyVercelOidcToken(token); }
  catch { throw new Error("INTERNAL_UNAUTHORIZED"); }
}

export async function handleCodexGenerationBridge(request: Request) {
  try {
    await assertProjectOidc(request);
    const input = Schema.parse(await request.json());
    const result = await generateCodexWorkerStructured(input.userId, {
      schemaName: input.schemaName,
      jsonSchema: input.jsonSchema,
      system: input.system,
      prompt: input.prompt,
      timeoutMs: input.timeoutMs,
      parse: (value) => value
    });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CODEX_INTERNAL_FAILED";
    const status = message === "INTERNAL_UNAUTHORIZED" ? 401 : message === "CODEX_USAGE_LIMIT" ? 429 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
