import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";

type Relation<T> = T | T[] | null;
type SectionProgressRow = {
  id: string;
  title: string;
  status: string;
  word_count: number;
  target_words: number;
  chapter: Relation<{ title: string }>;
};

function one<T>(value: Relation<T>): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { supabase } = await requireUser();
    const [{ data: book, error }, { data: jobs }, { data: logs }, { data: rawSections, error: sectionsError }] = await Promise.all([
      supabase.from("books").select("id,status,progress,current_section_id,quality_score,quality_scores").eq("id", id).single(),
      supabase.from("generation_jobs").select("id,status,progress,workflow_run_id,created_at,updated_at").eq("book_id", id).order("created_at", { ascending: false }).limit(1),
      supabase.from("job_logs").select("id,level,message,metadata,created_at,generation_job_id").eq("book_id", id).order("created_at", { ascending: false }).limit(30),
      supabase.from("sections").select("id,title,status,word_count,target_words,chapter:chapters(title)").eq("book_id", id)
    ]);
    if (error) throw error;
    if (sectionsError) throw sectionsError;

    const sections = (rawSections ?? []) as unknown as SectionProgressRow[];
    const totalSections = sections.length;
    const completedSections = sections.filter((section) => section.status === "COMPLETED").length;
    const generatedWords = sections.reduce((sum, section) => sum + Number(section.word_count || 0), 0);
    const targetWords = sections.reduce((sum, section) => sum + Number(section.target_words || 0), 0);
    const current = sections.find((section) => section.id === book.current_section_id) ?? null;
    const latestJob = jobs?.[0] ?? null;
    const calculatedProgress = totalSections > 0 ? (completedSections / totalSections) * 100 : Number(book.progress ?? 0);
    const planningProgress = book.status === "PLANNING" && latestJob ? Number(latestJob.progress ?? 0) : 0;
    const effectiveProgress = book.status === "COMPLETED"
      ? 100
      : book.status === "PLANNING"
        ? Math.max(Number(book.progress ?? 0), planningProgress)
        : Math.max(Number(book.progress ?? 0), calculatedProgress);

    return NextResponse.json({
      book: { ...book, progress: effectiveProgress },
      progressDetails: {
        completedSections,
        totalSections,
        generatedWords,
        targetWords,
        currentSectionTitle: current?.title ?? null,
        currentChapterTitle: current ? one(current.chapter)?.title ?? null : null
      },
      job: latestJob,
      logs: logs ?? []
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Status failed." }, { status: 400 });
  }
}
