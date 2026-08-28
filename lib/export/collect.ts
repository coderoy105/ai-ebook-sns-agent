import { createServiceSupabase } from "@/lib/supabase/server";

export type ExportSection={id:string;title:string;position:number;content_markdown:string|null};
export type ExportChapter={id:string;title:string;position:number;sections:ExportSection[]};
export type ExportPart={id:string;title:string;position:number;chapters:ExportChapter[]};
export type ExportBook={id:string;title:string;subtitle:string|null;book_type:string;parts:ExportPart[]};

export async function collectBook(bookId:string):Promise<ExportBook>{
  const supabase=createServiceSupabase();
  const {data,error}=await supabase.from("books").select("id,title,subtitle,book_type,parts(id,title,position,chapters(id,title,position,sections(id,title,position,content_markdown)))").eq("id",bookId).single();
  if(error||!data)throw error??new Error("Book not found");
  const parts=(data.parts as any[]??[]).sort((a,b)=>a.position-b.position).map(part=>({...part,chapters:(part.chapters??[]).sort((a:any,b:any)=>a.position-b.position).map((chapter:any)=>({...chapter,sections:(chapter.sections??[]).sort((a:any,b:any)=>a.position-b.position)}))}));
  return {...data,parts} as ExportBook;
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
