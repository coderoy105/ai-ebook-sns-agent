import { NextResponse } from "next/server";
import { serviceBridgeHealth } from "@/lib/supabase/service-bridge";
import { createServiceSupabase } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const bridge = await serviceBridgeHealth();
    const supabase = createServiceSupabase();
    const { data: plans, error } = await supabase.from("plans").select("code").limit(1);
    if (error) throw new Error(`Bridge database check failed: ${error.message}`);

    const ok = bridge?.ok === true && Array.isArray(plans);
    return NextResponse.json(
      { ok, service: bridge?.service ?? "unknown", database: ok ? "reachable" : "unavailable" },
      { status: ok ? 200 : 503 }
    );
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Service bridge unavailable" }, { status: 503 });
  }
}
