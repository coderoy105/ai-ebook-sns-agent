import { NextResponse } from "next/server";
import { serviceBridgeHealth } from "@/lib/supabase/service-bridge";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await serviceBridgeHealth();
    return NextResponse.json({ ok: data?.ok === true, service: data?.service ?? "unknown" }, { status: data?.ok ? 200 : 503 });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Service bridge unavailable" }, { status: 503 });
  }
}
