import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";

const Schema = z.object({ action: z.enum(["pause", "resume", "cancel"]) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase } = await requireUser();
    const { action } = Schema.parse(await request.json());
    const status = action === "pause" ? "PAUSED" : action === "resume" ? "GENERATING" : "CANCELLED";
    const { error } = await supabase.from("books").update({ status }).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ status });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Control failed." }, { status: 400 });
  }
}
