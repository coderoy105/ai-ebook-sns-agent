import { NextResponse } from "next/server";
import { z } from "zod";

const Schema = z.object({
  code: z.string().min(8).max(1000),
  verifier: z.string().min(20).max(1000)
});

type OpenRouterExchange = { key?: string; error?: { message?: string } };

export async function POST(request: Request) {
  try {
    const { code, verifier } = Schema.parse(await request.json());
    const response = await fetch("https://openrouter.ai/api/v1/auth/keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: "S256" })
    });
    const payload = await response.json() as OpenRouterExchange;
    if (!response.ok || !payload.key) {
      return NextResponse.json({ error: payload.error?.message ?? "무료 AI 연결에 실패했습니다." }, { status: response.status || 400 });
    }
    return NextResponse.json({ key: payload.key });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "무료 AI 연결에 실패했습니다." }, { status: 400 });
  }
}
