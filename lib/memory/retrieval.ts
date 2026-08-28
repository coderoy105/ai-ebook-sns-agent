import { createServiceSupabase } from "@/lib/supabase/server";
import { llm } from "@/lib/ai/openai";

export type MemoryHit = {
  id: string;
  memory_type: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
};

export async function retrieveBookMemory(bookId: string, query: string, limit = 10) {
  const embedding = await llm.embed(query);
  const supabase = createServiceSupabase();
  const { data, error } = await supabase.rpc("match_book_memory", {
    query_embedding: embedding,
    match_book_id: bookId,
    match_count: limit,
    min_similarity: 0.38
  });
  if (error) throw error;
  return (data ?? []) as MemoryHit[];
}

export async function addMemory(input: {
  bookId: string;
  type: string;
  content: string;
  metadata?: Record<string, unknown>;
  sourceSectionId?: string;
}) {
  const embedding = await llm.embed(input.content);
  const supabase = createServiceSupabase();
  const { error } = await supabase.from("book_memories").insert({
    book_id: input.bookId,
    memory_type: input.type,
    content: input.content,
    metadata: input.metadata ?? {},
    source_section_id: input.sourceSectionId ?? null,
    embedding
  });
  if (error) throw error;
}

export async function highestRepetitionScore(bookId: string, summary: string, excludeSectionId: string) {
  const hits = await retrieveBookMemory(bookId, summary, 5);
  return hits
    .filter((hit) => hit.memory_type === "SECTION_SUMMARY" && hit.metadata?.sectionId !== excludeSectionId)
    .reduce((max, hit) => Math.max(max, hit.similarity), 0);
}
