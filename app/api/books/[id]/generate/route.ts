import { NextResponse } from "next/server";
import { start } from "workflow/api";
import { generateBookWorkflow } from "@/lib/jobs/book-workflow";
import { requireUser } from "@/lib/supabase/server";
import { assertRateLimit } from "@/lib/security/rate-limit";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { supabase, user } = await requireUser();
    await assertRateLimit(user.id, "book-generate", 6, 3600);
    const { data: book, error } = await supabase.from("books").select("id,status").eq("id", id).single();
    if (error || !book) return NextResponse.json({ error: "Book not found." }, { status: 404 });

    const { data: job, error: jobError } = await supabase.from("generation_jobs").insert({
      book_id: id, user_id: user.id, status: "QUEUED", progress: 0
    }).select("id").single();
    if (jobError) throw jobError;

    const run = await start(generateBookWorkflow, [{ bookId: id, userId: user.id, jobId: job.id }]);
    await supabase.from("generation_jobs").update({ workflow_run_id: run.runId }).eq("id", job.id);
    await supabase.from("books").update({ status: "GENERATING" }).eq("id", id);

    return NextResponse.json({ jobId: job.id, runId: run.runId });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Generation failed." }, { status: 400 });
  }
}
