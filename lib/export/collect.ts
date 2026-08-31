import { createServiceSupabase } from "@/lib/supabase/server";
import { normalizeCoverConcept, type CoverConcept } from "@/lib/design/cover-system";

export type ExportSection={id:string;title:string;position:number;content_markdown:string|null};
export type ExportChapter={id:string;title:string;position:number;sections:ExportSection[]};
export type ExportPart={id:string;title:string;position:number;chapters:ExportChapter[]};
export type ExportBook={id:string;title:string;subtitle:string|null;book_type:string;cover:CoverConcept;parts:ExportPart[]};

type CoverRow={concept:unknown;is_selected?:boolean;created_at?:string};

export async function collectBook(bookId:string):Promise<ExportBook>{
  const supabase=createServiceSupabase();
  const {data,error}=await supabase.from("books").select("id,title,subtitle,idea,book_type,book_covers(concept,is_selected,created_at),parts(id,title,position,chapters(id,title,position,sections(id,title,position,content_markdown)))").eq("id",bookId).single();
  if(error||!data)throw error??new Error("Book not found");
  const rawParts=(data.parts??[]) as unknown as ExportPart[];
  const parts=[...rawParts].sort((a,b)=>a.position-b.position).map(part=>({
    ...part,
    chapters:[...(part.chapters??[])].sort((a,b)=>a.position-b.position).map(chapter=>({
      ...chapter,
      sections:[...(chapter.sections??[])].sort((a,b)=>a.position-b.position)
    }))
  }));
  const covers=((data.book_covers??[]) as unknown as CoverRow[]).sort((a,b)=>Number(Boolean(b.is_selected))-Number(Boolean(a.is_selected)));
  const cover=normalizeCoverConcept(covers[0]?.concept,{title:String(data.title),subtitle:data.subtitle?String(data.subtitle):null,bookType:data.book_type?String(data.book_type):null,idea:data.idea?String(data.idea):null});
  return {id:data.id,title:data.title,subtitle:data.subtitle,book_type:data.book_type,cover,parts};
}

export function stripMarkdown(markdown:string){
  return markdown.replace(/```[\s\S]*?```/g,(m)=>m.replace(/```[^\n]*\n?/g,"").replace(/```$/,""))
    .replace(/^#{1,6}\s+/gm,"").replace(/^>\s?/gm,"").replace(/\*\*([^*]+)\*\*/g,"$1").replace(/\*([^*]+)\*/g,"$1").replace(/`([^`]+)`/g,"$1").replace(/^[-*+]\s+/gm,"• ").trim();
}

export function bookToMarkdown(book:ExportBook){
  const lines=[`# ${book.title}`,book.subtitle?`## ${book.subtitle}`:"",""];
  for(const part of book.parts){lines.push(`# ${part.title}`,"");for(const chapter of part.chapters){lines.push(`## ${chapter.title}`,"");for(const section of chapter.sections){lines.push(`### ${section.title}`,"",section.content_markdown??""," ");}}}
  return lines.join("\n");
}
