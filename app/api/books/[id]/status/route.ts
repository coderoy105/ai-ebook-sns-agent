import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { supabase } = await requireUser();
    const [{ data: book, error }, { data: jobs }, { data: logs }] = await Promise.all([
      supabase.from("books").select("id,status,progress,current_section_id,quality_score,quality_scores").eq("id", id).single(),
      supabase.from("generation_jobs").select("id,status,progress,workflow_run_id,created_at,updated_at").eq("book_id", id).order("created_at", { ascending: false }).limit(1),
      supabase.from("job_logs").select("id,level,message,metadata,created_at,generation_job_id").eq("book_id", id).order("created_at", { ascending: false }).limit(30)
    ]);
    if (error) throw error;
    return NextResponse.json({ book, job: jobs?.[0] ?? null, logs: logs ?? [] });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Status failed." }, { status: 400 });
  }
}
