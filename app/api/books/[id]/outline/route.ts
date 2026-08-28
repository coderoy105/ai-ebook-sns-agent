import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/supabase/server";

const AddSchema=z.object({kind:z.enum(["chapter","section"]),parentId:z.string().uuid(),title:z.string().min(1).max(500)});
const ReorderSchema=z.object({kind:z.enum(["chapter","section"]),ids:z.array(z.string().uuid()).min(1).max(200)});

export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
  try{const {id:bookId}=await params;const {supabase}=await requireUser();const {data:book}=await supabase.from("books").select("id").eq("id",bookId).single();if(!book)return NextResponse.json({error:"Not found"},{status:404});const input=AddSchema.parse(await request.json());
    if(input.kind==="chapter"){
      const {data:parent}=await supabase.from("parts").select("id,book_id").eq("id",input.parentId).eq("book_id",bookId).single();if(!parent)return NextResponse.json({error:"Invalid parent"},{status:400});const {count}=await supabase.from("chapters").select("id",{count:"exact",head:true}).eq("part_id",input.parentId);const {error}=await supabase.from("chapters").insert({book_id:bookId,part_id:input.parentId,position:count??0,title:input.title,goal:"User-added chapter",target_words:1200,status:"PLANNED"});if(error)throw error;
    }else{
      const {data:parent}=await supabase.from("chapters").select("id,book_id").eq("id",input.parentId).eq("book_id",bookId).single();if(!parent)return NextResponse.json({error:"Invalid parent"},{status:400});const {count}=await supabase.from("sections").select("id",{count:"exact",head:true}).eq("chapter_id",input.parentId);const {error}=await supabase.from("sections").insert({book_id:bookId,chapter_id:input.parentId,position:count??0,title:input.title,goal:"User-added section",target_words:500,research_needed:false,status:"PLANNED"});if(error)throw error;
    }
    return NextResponse.json({ok:true});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Add failed"},{status:400});}
}

export async function PATCH(request:Request,{params}:{params:Promise<{id:string}>}){
  try{const {id:bookId}=await params;const {supabase}=await requireUser();const {data:book}=await supabase.from("books").select("id").eq("id",bookId).single();if(!book)return NextResponse.json({error:"Not found"},{status:404});const input=ReorderSchema.parse(await request.json());const table=input.kind==="chapter"?"chapters":"sections";
    const {data:rows,error:readError}=await supabase.from(table).select("id,book_id").in("id",input.ids);if(readError)throw readError;if((rows??[]).length!==input.ids.length||(rows??[]).some((row:any)=>row.book_id!==bookId))return NextResponse.json({error:"Invalid outline selection"},{status:400});
    for(let i=0;i<input.ids.length;i++){const {error}=await supabase.from(table).update({position:i}).eq("id",input.ids[i]);if(error)throw error;}
    return NextResponse.json({ok:true});
  }catch(e){return NextResponse.json({error:e instanceof Error?e.message:"Reorder failed"},{status:400});}
}
