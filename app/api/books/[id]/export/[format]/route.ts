import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";
import { collectBook, bookToMarkdown, stripMarkdown } from "@/lib/export/collect";
import { renderBookPdf } from "@/lib/export/pdf";
import { renderBookEpub } from "@/lib/export/epub";
import { renderBookDocx } from "@/lib/export/docx";
import { assertRateLimit } from "@/lib/security/rate-limit";

export const runtime="nodejs";
export const maxDuration=300;

const formats={
  pdf:{type:"application/pdf",ext:"pdf"},epub:{type:"application/epub+zip",ext:"epub"},
  docx:{type:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",ext:"docx"},
  md:{type:"text/markdown; charset=utf-8",ext:"md"},txt:{type:"text/plain; charset=utf-8",ext:"txt"}
} as const;

function safeName(title:string){return title.replace(/[\\/:*?"<>|]/g,"_").slice(0,80)||"book";}

export async function GET(_:Request,{params}:{params:Promise<{id:string;format:string}>}){
  try{const {id,format}=await params;if(!(format in formats))return NextResponse.json({error:"Unsupported format"},{status:400});const {supabase,user}=await requireUser();await assertRateLimit(user.id,"book-export",20,3600);const {data:owned}=await supabase.from("books").select("id,title").eq("id",id).single();if(!owned)return NextResponse.json({error:"Book not found"},{status:404});
    const exportFormat=format as keyof typeof formats;const {data:job}=await supabase.from("export_jobs").insert({book_id:id,user_id:user.id,format:exportFormat.toUpperCase(),status:"RUNNING"}).select("id").single();
    try{const book=await collectBook(id);let body:Uint8Array;
      if(exportFormat==="pdf")body=new Uint8Array(await renderBookPdf(book));
      else if(exportFormat==="epub")body=new Uint8Array(await renderBookEpub(book));
      else if(exportFormat==="docx")body=new Uint8Array(await renderBookDocx(book));
      else {const markdown=bookToMarkdown(book);const text=exportFormat==="txt"?stripMarkdown(markdown):markdown;body=new TextEncoder().encode(text);}
      if(job)await supabase.from("export_jobs").update({status:"COMPLETED",finished_at:new Date().toISOString()}).eq("id",job.id);
      const meta=formats[exportFormat];return new Response(body,{headers:{"content-type":meta.type,"content-disposition":`attachment; filename*=UTF-8''${encodeURIComponent(safeName(book.title))}.${meta.ext}`,"cache-control":"private, no-store"}});
    }catch(error){if(job)await supabase.from("export_jobs").update({status:"FAILED",error_message:error instanceof Error?error.message:String(error),finished_at:new Date().toISOString()}).eq("id",job.id);throw error;}
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Export failed"},{status:400});}
}
