import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase, requireUser } from "@/lib/supabase/server";

const Schema = z.object({
  code: z.string().min(8).max(1000),
  verifier: z.string().min(20).max(1000)
});

type OpenRouterExchange = { key?: string; error?: { message?: string } };

export async function POST(request: Request) {
  try {
    const { user } = await requireUser();
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

    const service = createServiceSupabase();
    const { error: vaultError } = await service.rpc("store_openrouter_credential", {
      p_user_id: user.id,
      p_secret: payload.key
    });
    if (vaultError) throw new Error(`FREE_AI_VAULT_SAVE_FAILED: ${vaultError.message}`);

    // Browser keeps a session copy for immediate interactive actions; the durable
    // background workflow reads the encrypted server-side copy from Supabase Vault.
    return NextResponse.json({ key: payload.key, backgroundReady: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "무료 AI 연결에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: message === "UNAUTHORIZED" ? 401 : 400 });
  }
}
