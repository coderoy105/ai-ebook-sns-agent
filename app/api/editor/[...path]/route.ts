import { NextResponse } from "next/server";
import { z } from "zod";
import { createServiceSupabase, requireUser } from "@/lib/supabase/server";
import { generateBackgroundStructured, hasBackgroundCredential, normalizeBackgroundProvider } from "@/lib/ai/background-provider";
import { assertRateLimit } from "@/lib/security/rate-limit";

const ControlSchema = z.object({ action: z.enum(["pause", "resume", "cancel"]) });
const AddSchema = z.object({ kind: z.enum(["chapter", "section"]), parentId: z.string().uuid(), title: z.string().min(1).max(500) });
const ReorderSchema = z.object({ kind: z.enum(["chapter", "section"]), ids: z.array(z.string().uuid()).min(1).max(200) });
const TitleSchema = z.object({ title: z.string().min(1).max(500) });
const SectionSchema = z.object({ content: z.string().max(250000), title: z.string().max(500).optional() });
const RewriteInputSchema = z.object({ instruction: z.string().min(3).max(3000) });
const RewriteJsonSchema = {
  type: "object", additionalProperties: false, required: ["markdown", "summary"],
  properties: { markdown: { type: "string" }, summary: { type: "string" } }
};

const tableByKind = { part: "parts", chapter: "chapters", section: "sections" } as const;
type Kind = keyof typeof tableByKind;
type Relation<T> = T | T[] | null;
type SettingsRow = { planning_input?: { aiProvider?: unknown } | null };
type SectionProgressRow = { id:string; title:string; status:string; word_count:number; target_words:number; chapter:Relation<{title:string}> };

function one<T>(value: Relation<T>): T | null { return Array.isArray(value) ? (value[0] ?? null) : value; }
function pathOf(params: Promise<{path:string[]}>) { return params.then((value) => value.path ?? []); }
function bad(message:string,status=400){ return NextResponse.json({error:message},{status}); }

async function ownedOutline(supabase: Awaited<ReturnType<typeof requireUser>>["supabase"], kind: Kind, id: string) {
  const { data, error } = await supabase.from(tableByKind[kind]).select("id,book_id").eq("id", id).single();
  if (error || !data) return null;
  const { data: book } = await supabase.from("books").select("id").eq("id", data.book_id).single();
  return book ? data : null;
}

async function statusResponse(bookId:string) {
  const { supabase } = await requireUser();
  const [{data:book,error},{data:jobs},{data:logs},{data:rawSections,error:sectionsError}] = await Promise.all([
    supabase.from("books").select("id,status,progress,current_section_id,quality_score,quality_scores,book_settings(planning_input)").eq("id",bookId).single(),
    supabase.from("generation_jobs").select("id,status,progress,workflow_run_id,created_at,updated_at").eq("book_id",bookId).order("created_at",{ascending:false}).limit(1),
    supabase.from("job_logs").select("id,level,message,metadata,created_at,generation_job_id").eq("book_id",bookId).order("created_at",{ascending:false}).limit(30),
    supabase.from("sections").select("id,title,status,word_count,target_words,chapter:chapters(title)").eq("book_id",bookId)
  ]);
  if(error) throw error;
  if(sectionsError) throw sectionsError;
  const sections=(rawSections??[]) as unknown as SectionProgressRow[];
  const totalSections=sections.length;
  const completedSections=sections.filter((section)=>section.status==="COMPLETED").length;
  const generatedWords=sections.reduce((sum,section)=>sum+Number(section.word_count||0),0);
  const targetWords=sections.reduce((sum,section)=>sum+Number(section.target_words||0),0);
  const current=sections.find((section)=>section.id===book.current_section_id)??null;
  const latestJob=jobs?.[0]??null;
  const calculatedProgress=totalSections>0?(completedSections/totalSections)*100:Number(book.progress??0);
  const planningProgress=book.status==="PLANNING"&&latestJob?Number(latestJob.progress??0):0;
  const effectiveProgress=book.status==="COMPLETED"?100:book.status==="PLANNING"?Math.max(Number(book.progress??0),planningProgress):Math.max(Number(book.progress??0),calculatedProgress);
  const settingsRelation=book.book_settings as unknown as Relation<SettingsRow>;
  const provider=normalizeBackgroundProvider(one(settingsRelation)?.planning_input?.aiProvider);
  const {book_settings: _bookSettings,...bookPayload}=book;
  void _bookSettings;
  return NextResponse.json({
    book:{...bookPayload,progress:effectiveProgress}, aiProvider:provider,
    aiModel:provider==="codex"?"gpt-5.6-luna":"openrouter/free",
    progressDetails:{completedSections,totalSections,generatedWords,targetWords,currentSectionTitle:current?.title??null,currentChapterTitle:current?one(current.chapter)?.title??null:null},
    job:latestJob,logs:logs??[]
  });
}

export async function GET(_:Request,{params}:{params:Promise<{path:string[]}>}){
  try{
    const path=await pathOf(params);
    if(path[0]==="book"&&path[2]==="status") return statusResponse(path[1]);
    if(path[0]==="section"&&path[2]==="revisions"){
      const {supabase}=await requireUser();
      const {data:section}=await supabase.from("sections").select("id").eq("id",path[1]).single();
      if(!section)return bad("Not found",404);
      const {data,error}=await supabase.from("revisions").select("id,revision_type,instruction,title_before,content_before,created_at").eq("section_id",path[1]).order("created_at",{ascending:false}).limit(50);
      if(error)throw error;
      return NextResponse.json({revisions:data??[]});
    }
    return bad("Unknown editor route",404);
  }catch(error){return bad(error instanceof Error?error.message:"Editor GET failed");}
}

export async function PATCH(request:Request,{params}:{params:Promise<{path:string[]}>}){
  try{
    const path=await pathOf(params);
    const {supabase,user}=await requireUser();
    if(path[0]==="section"&&path.length===2){
      const input=SectionSchema.parse(await request.json());
      const {data:existing,error}=await supabase.from("sections").select("id,title,content_markdown,book_id,books!inner(user_id)").eq("id",path[1]).single();
      const owner=existing?.books as {user_id?:string}|null|undefined;
      if(error||!existing||owner?.user_id!==user.id)return bad("Not found.",404);
      await supabase.from("revisions").insert({book_id:existing.book_id,section_id:path[1],user_id:user.id,revision_type:"MANUAL",title_before:existing.title,content_before:existing.content_markdown});
      const {error:updateError}=await supabase.from("sections").update({content_markdown:input.content,...(input.title?{title:input.title}:{}),word_count:input.content.trim().split(/\s+/u).filter(Boolean).length,updated_at:new Date().toISOString()}).eq("id",path[1]);
      if(updateError)throw updateError;
      return NextResponse.json({ok:true});
    }
    if(path[0]==="outline"&&path.length===3){
      const kind=path[1]; const id=path[2];
      if(!(kind in tableByKind))return bad("Invalid kind");
      if(!await ownedOutline(supabase,kind as Kind,id))return bad("Not found",404);
      const input=TitleSchema.parse(await request.json());
      const {error}=await supabase.from(tableByKind[kind as Kind]).update({title:input.title}).eq("id",id);if(error)throw error;
      return NextResponse.json({ok:true});
    }
    if(path[0]==="book"&&path[2]==="outline"){
      const bookId=path[1]; const {data:book}=await supabase.from("books").select("id").eq("id",bookId).single();if(!book)return bad("Not found",404);
      const input=ReorderSchema.parse(await request.json()); const table=input.kind==="chapter"?"chapters":"sections";
      const {data:rows,error:readError}=await supabase.from(table).select("id,book_id").in("id",input.ids);if(readError)throw readError;
      if((rows??[]).length!==input.ids.length||(rows??[]).some((row:{book_id:string})=>row.book_id!==bookId))return bad("Invalid outline selection");
      for(let i=0;i<input.ids.length;i++){const {error}=await supabase.from(table).update({position:i}).eq("id",input.ids[i]);if(error)throw error;}
      return NextResponse.json({ok:true});
    }
    return bad("Unknown editor route",404);
  }catch(error){return bad(error instanceof Error?error.message:"Editor PATCH failed");}
}

export async function POST(request:Request,{params}:{params:Promise<{path:string[]}>}){
  try{
    const path=await pathOf(params);
    const {supabase,user}=await requireUser();
    if(path[0]==="book"&&path[2]==="control"){
      const {action}=ControlSchema.parse(await request.json());
      const status=action==="pause"?"PAUSED":action==="resume"?"GENERATING":"CANCELLED";
      const {error}=await supabase.from("books").update({status}).eq("id",path[1]);if(error)throw error;
      return NextResponse.json({status});
    }
    if(path[0]==="book"&&path[2]==="outline"){
      const bookId=path[1]; const {data:book}=await supabase.from("books").select("id").eq("id",bookId).single();if(!book)return bad("Not found",404);
      const input=AddSchema.parse(await request.json());
      if(input.kind==="chapter"){
        const {data:parent}=await supabase.from("parts").select("id,book_id").eq("id",input.parentId).eq("book_id",bookId).single();if(!parent)return bad("Invalid parent");
        const {count}=await supabase.from("chapters").select("id",{count:"exact",head:true}).eq("part_id",input.parentId);
        const {error}=await supabase.from("chapters").insert({book_id:bookId,part_id:input.parentId,position:count??0,title:input.title,goal:"User-added chapter",target_words:1200,status:"PLANNED"});if(error)throw error;
      }else{
        const {data:parent}=await supabase.from("chapters").select("id,book_id").eq("id",input.parentId).eq("book_id",bookId).single();if(!parent)return bad("Invalid parent");
        const {count}=await supabase.from("sections").select("id",{count:"exact",head:true}).eq("chapter_id",input.parentId);
        const {error}=await supabase.from("sections").insert({book_id:bookId,chapter_id:input.parentId,position:count??0,title:input.title,goal:"User-added section",target_words:500,research_needed:false,status:"PLANNED"});if(error)throw error;
      }
      return NextResponse.json({ok:true});
    }
    if(path[0]==="revision"&&path[2]==="restore"){
      const id=path[1]; const {data:revision,error}=await supabase.from("revisions").select("*").eq("id",id).single();if(error||!revision)return bad("Revision not found",404);
      const {data:section}=await supabase.from("sections").select("id,title,content_markdown,book_id").eq("id",revision.section_id).single();if(!section)return bad("Section not found",404);
      await supabase.from("revisions").insert({book_id:section.book_id,section_id:section.id,user_id:user.id,revision_type:"RESTORE_SNAPSHOT",title_before:section.title,content_before:section.content_markdown,instruction:`Before restoring revision ${id}`});
      const content=revision.content_before??""; const {error:updateError}=await supabase.from("sections").update({title:revision.title_before??section.title,content_markdown:content,word_count:content.trim().split(/\s+/u).filter(Boolean).length}).eq("id",section.id);if(updateError)throw updateError;
      return NextResponse.json({ok:true,content});
    }
    if(path[0]==="section"&&path[2]==="rewrite"){
      await assertRateLimit(user.id,"ai-edit",30,3600);
      const {instruction}=RewriteInputSchema.parse(await request.json()); const id=path[1];
      const {data:section,error}=await supabase.from("sections").select("*, chapter:chapters(title,goal), book:books!sections_book_id_fkey(user_id,title,idea,book_settings(planning_input))").eq("id",id).single();
      if(error||!section||section.book.user_id!==user.id)return bad("Not found.",404);
      const settings=one(section.book.book_settings as unknown as Relation<SettingsRow>); const provider=normalizeBackgroundProvider(settings?.planning_input?.aiProvider); const service=createServiceSupabase();
      if(provider==="openrouter"){
        const requestKey=request.headers.get("x-openrouter-key")?.trim();if(requestKey&&requestKey.length>=16){const {error:saveError}=await service.rpc("store_openrouter_credential",{p_user_id:user.id,p_secret:requestKey});if(saveError)throw new Error(saveError.message);}
      }
      if(!(await hasBackgroundCredential(user.id,provider)))return NextResponse.json({error:provider==="codex"?"CODEX_CONNECTION_REQUIRED":"FREE_AI_CONNECTION_REQUIRED",reconnect:true,provider},{status:428});
      await supabase.from("revisions").insert({book_id:section.book_id,section_id:id,user_id:user.id,revision_type:"AI",title_before:section.title,content_before:section.content_markdown,instruction});
      const result=await generateBackgroundStructured(provider,user.id,{schemaName:"section_rewrite",jsonSchema:RewriteJsonSchema,system:"You are the AI editor inside a professional book editor. Apply the user's instruction only to this section. Preserve established facts and do not imitate named authors. Live web research is disabled; never fabricate citations or claims of checking the web.",prompt:`BOOK: ${section.book.title}\nCHAPTER: ${section.chapter.title}\nSECTION: ${section.title}\nINSTRUCTION: ${instruction}\n\nCURRENT MARKDOWN:\n${section.content_markdown??""}`,parse:(value:unknown)=>{const parsed=value as {markdown?:unknown;summary?:unknown};return{markdown:String(parsed.markdown??""),summary:String(parsed.summary??"")};}});
      await Promise.all([
        supabase.from("sections").update({content_markdown:result.value.markdown,summary:result.value.summary,word_count:result.value.markdown.trim().split(/\s+/u).filter(Boolean).length,updated_at:new Date().toISOString()}).eq("id",id),
        supabase.from("token_usage").insert({user_id:user.id,book_id:section.book_id,operation:provider==="codex"?"CODEX_LUNA_SECTION_REWRITE":"FREE_SECTION_REWRITE",model:result.usage.model,input_tokens:result.usage.inputTokens,output_tokens:result.usage.outputTokens,estimated_cost:0,duration_ms:result.usage.durationMs,retry_count:0})
      ]);
      return NextResponse.json({...result.value,aiMode:provider,model:result.usage.model});
    }
    return bad("Unknown editor route",404);
  }catch(error){
    const message=error instanceof Error?error.message:"Editor POST failed";
    const status=message==="FREE_AI_DAILY_LIMIT"||message==="CODEX_USAGE_LIMIT"?429:400;
    return NextResponse.json({error:message},{status});
  }
}

export async function DELETE(_:Request,{params}:{params:Promise<{path:string[]}>}){
  try{
    const path=await pathOf(params); if(path[0]!=="outline"||path.length!==3)return bad("Unknown editor route",404);
    const kind=path[1];const id=path[2];if(kind!=="chapter"&&kind!=="section")return bad("Only chapters and sections can be deleted here.");
    const {supabase}=await requireUser();if(!await ownedOutline(supabase,kind,id))return bad("Not found",404);
    const {error}=await supabase.from(tableByKind[kind]).delete().eq("id",id);if(error)throw error;
    return NextResponse.json({ok:true});
  }catch(error){return bad(error instanceof Error?error.message:"Delete failed");}
}
