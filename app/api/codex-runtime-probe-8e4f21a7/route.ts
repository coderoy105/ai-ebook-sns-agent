import { NextResponse } from "next/server";
import { logoutCodexRuntime, startCodexRuntimeLogin } from "@/lib/ai/codex-runtime-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PROBE_USER_ID = "00000000-0000-4000-8000-000000000123";

export async function GET() {
  try {
    const result = await startCodexRuntimeLogin(PROBE_USER_ID);
    return NextResponse.json({
      ok: true,
      oidcBridge: true,
      runtime: true,
      appServer: true,
      deviceCode: result.type === "chatgptDeviceCode" || result.type === "already_connected"
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "CODEX_RUNTIME_PROBE_FAILED"
    }, { status: 500, headers: { "cache-control": "no-store" } });
  } finally {
    await logoutCodexRuntime(PROBE_USER_ID).catch(() => undefined);
  }
}
