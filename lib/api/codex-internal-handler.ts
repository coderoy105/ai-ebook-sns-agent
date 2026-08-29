import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase/server";
import { generateServerlessCodexStructured } from "@/lib/ai/codex-serverless";

const InternalGenerateSchema = z.object({
  schemaName: z.string().min(1).max(120),
  jsonSchema: z.record(z.string(), z.unknown()),
  system: z.string().min(1).max(100_000),
  prompt: z.string().min(1).max(300_000),
  timeoutMs: z.number().int().min(10_000).max(240_000).optional()
});

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function consumeTicket(rawTicket: string) {
  if (rawTicket.length < 60 || rawTicket.length > 160) throw new Error("CODEX_INTERNAL_UNAUTHORIZED");
  const service = createServiceSupabase();
  const { data, error } = await service.rpc<string | null>("consume_codex_internal_ticket", {
    p_ticket_hash: await sha256(rawTicket)
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("CODEX_INTERNAL_UNAUTHORIZED");
  return data;
}

export async function handleCodexInternalGenerate(request: Request) {
  try {
    const ticket = request.headers.get("x-ai-book-codex-ticket")?.trim() ?? "";
    const userId = await consumeTicket(ticket);
    const input = InternalGenerateSchema.parse(await request.json());
    const result = await generateServerlessCodexStructured(userId, {
      ...input,
      parse: (value) => value
    });
    return NextResponse.json(result, {
      status: 200,
      headers: { "cache-control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "CODEX_INTERNAL_FAILED";
    const status = message === "CODEX_INTERNAL_UNAUTHORIZED" ? 401
      : message === "CODEX_LUNA_UNAVAILABLE" ? 409
      : message === "CODEX_CONNECTION_REQUIRED" ? 428
      : 400;
    return NextResponse.json({ error: message }, { status, headers: { "cache-control": "no-store" } });
  }
}
