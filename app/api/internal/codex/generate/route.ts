import { NextResponse } from "next/server";
import { z } from "zod";
import { CodexPlusProvider } from "@/lib/ai/codex-plus";
import { SUPABASE_URL } from "@/lib/supabase/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  if (!authorization.startsWith("Bearer ")) throw new Error("INTERNAL_UNAUTHORIZED");

  // Reuse the production service bridge as the single source of truth for
  // validating Vercel OIDC issuer, audience and exact production project subject.
  const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-book-service`, {
    method: "POST",
    headers: { authorization, "content-type": "application/json" },
    body: JSON.stringify({ kind: "health" }),
    cache: "no-store"
  });
  if (!response.ok) throw new Error("INTERNAL_UNAUTHORIZED");
}

export async function POST(request: Request) {
  try {
    await assertProjectOidc(request);
    const input = Schema.parse(await request.json());
    const provider = new CodexPlusProvider(input.userId);
    const result = await provider.generateStructured({
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
