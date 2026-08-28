import { NextResponse } from "next/server";
import { requireUser } from "@/lib/supabase/server";

export async function GET(_:Request,{params}:{params:Promise<{id:string}>}){
  try{const {id}=await params;const {supabase}=await requireUser();const {data:section}=await supabase.from("sections").select("id").eq("id",id).single();if(!section)return NextResponse.json({error:"Not found"},{status:404});const {data,error}=await supabase.from("revisions").select("id,revision_type,instruction,title_before,content_before,created_at").eq("section_id",id).order("created_at",{ascending:false}).limit(50);if(error)throw error;return NextResponse.json({revisions:data??[]});}catch(e){return NextResponse.json({error:e instanceof Error?e.message:"History failed"},{status:400});}
}
