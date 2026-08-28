import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";

const UpdateSchema=z.object({title:z.string().min(1).max(500)});
const tableByKind={part:"parts",chapter:"chapters",section:"sections"} as const;
type Kind=keyof typeof tableByKind;

async function owned(supabase:any,kind:Kind,id:string){
  const table=tableByKind[kind];
  const {data,error}=await supabase.from(table).select("id,book_id").eq("id",id).single();
  if(error||!data)return null;
  const {data:book}=await supabase.from("books").select("id").eq("id",data.book_id).single();
  return book?data:null;
}

export async function PATCH(request:Request,{params}:{params:Promise<{kind:string;id:string}>}){
  try{const {kind,id}=await params;if(!(kind in tableByKind))return NextResponse.json({error:"Invalid kind"},{status:400});const {supabase}=await requireUser();if(!await owned(supabase,kind as Kind,id))return NextResponse.json({error:"Not found"},{status:404});const input=UpdateSchema.parse(await request.json());const {error}=await supabase.from(tableByKind[kind as Kind]).update({title:input.title}).eq("id",id);if(error)throw error;return NextResponse.json({ok:true});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Update failed"},{status:400});}
}

export async function DELETE(_:Request,{params}:{params:Promise<{kind:string;id:string}>}){
  try{const {kind,id}=await params;if(kind!=="chapter"&&kind!=="section")return NextResponse.json({error:"Only chapters and sections can be deleted here."},{status:400});const {supabase}=await requireUser();if(!await owned(supabase,kind,id))return NextResponse.json({error:"Not found"},{status:404});const {error}=await supabase.from(tableByKind[kind]).delete().eq("id",id);if(error)throw error;return NextResponse.json({ok:true});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Delete failed"},{status:400});}
}
