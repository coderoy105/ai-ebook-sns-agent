import { NextResponse } from "next/server";
import { z } from "zod";
import { llm } from "@/lib/ai/openai";

export const dynamic = "force-dynamic";

const ProbeSchema = z.object({ ok: z.literal(true) });
const probeJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["ok"],
  properties: { ok: { type: "boolean", const: true } }
} as const;

export async function GET() {
  try {
    const result = await llm.generateStructured({
      model: "gpt-5",
      schemaName: "gateway_probe",
      jsonSchema: probeJsonSchema as unknown as Record<string, unknown>,
      system: "Return the requested JSON only.",
      prompt: "Return {\"ok\":true}.",
      parse: (value) => ProbeSchema.parse(value)
    });
    return NextResponse.json({
      ok: result.value.ok,
      model: result.usage.model,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "AI Gateway unavailable" }, { status: 503 });
  }
}
