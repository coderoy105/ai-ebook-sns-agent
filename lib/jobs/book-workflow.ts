import { sleep } from "workflow";
import { z } from "zod";
import { createServiceSupabase } from "@/lib/supabase/server";
import { llm } from "@/lib/ai/openai";
import { sectionDraftJsonSchema, reviewJsonSchema } from "@/lib/ai/json-schemas";
import { SectionDraftSchema, ReviewSchema } from "@/lib/ai/schemas";
import { sectionWriterPrompt, sectionWriterSystem } from "@/lib/ai/prompts";
import { addMemory, highestRepetitionScore, retrieveBookMemory } from "@/lib/memory/retrieval";
import { estimateOpenAICost, type ModelUsage } from "@/lib/ai/provider";
import { composeBookPages } from "@/lib/design/compose";
import { auditContinuity } from "@/lib/quality/continuity";

type WorkflowInput={bookId:string;userId:string;jobId:string};
type ProfileRow=Record<string,unknown>;
type Relation<T>=T|T[]|null;
type SectionContext={
  id:string;book_id:string;chapter_id:string;position:number;title:string;goal:string|null;target_words:number;
  research_needed:boolean;status:string;content_markdown:string|null;
  chapter:{id:string;title:string;goal:string|null;position:number};
  book:{id:string;title:string;subtitle:string|null;idea:string;book_family:string;reader_profiles:Relation<ProfileRow>;writing_styles:Relation<ProfileRow>;story_bibles:Relation<{data:unknown}>;knowledge_maps:Relation<{data:unknown}>};
};

type ReviewIssue={severity:"low"|"medium"|"high";scope:string;description:string;fixInstruction:string};

function one<T>(value:Relation<T>):T|null{return Array.isArray(value)?(value[0]??null):value;}

export async function generateBookWorkflow(input:WorkflowInput){
  "use workflow";
  try{
    await markJob(input.jobId,"GENERATING","Generation workflow started",0);
    const sectionIds=await getSectionIds(input.bookId);
    for(let index=0;index<sectionIds.length;index++){
      let state=await getBookControlState(input.bookId);
      while(state==="PAUSED"){
        await sleep("15s");
        state=await getBookControlState(input.bookId);
      }
      if(state==="CANCELLED"){
        await markJob(input.jobId,"CANCELLED","Cancelled by user",(index/Math.max(sectionIds.length,1))*92);
        return {status:"cancelled"};
      }
      await generateSectionStep({...input,sectionId:sectionIds[index],ordinal:index+1,total:sectionIds.length});
    }

    await markJob(input.jobId,"REVIEWING","Running global structure, continuity, repetition, tone and fact review",93);
    await globalReviewStep(input,"GLOBAL_REVIEW");
    const fixes=await getActionableReviewFixes(input.bookId);
    for(const fix of fixes)await fixReviewIssueStep({...input,fix});
    if(fixes.length>0)await globalReviewStep(input,"FINAL_REVIEW");
    await composePagesStep(input);
    await finalizeBook(input);
    return {status:"completed",targetedFixes:fixes.length};
  }catch(error){
    await failWorkflowStep(input,error instanceof Error?error.message:String(error));
    throw error;
  }
}

async function getSectionIds(bookId:string){
  "use step";
  const supabase=createServiceSupabase();
  const {data,error}=await supabase.from("sections").select("id,position,chapters(position)").eq("book_id",bookId);
  if(error)throw error;
  const rows=(data??[]) as unknown as Array<{id:string;position:number;chapters:Relation<{position:number}>}>;
  return rows.sort((a,b)=>((one(a.chapters)?.position??0)-(one(b.chapters)?.position??0))||a.position-b.position).map(row=>row.id);
}

async function getBookControlState(bookId:string){
  "use step";
  const supabase=createServiceSupabase();
  const {data,error}=await supabase.from("books").select("status").eq("id",bookId).single();
  if(error)throw error;
  return data.status as string;
}

async function markJob(jobId:string,status:string,message:string,progress:number){
  "use step";
  const supabase=createServiceSupabase();
  await supabase.from("generation_jobs").update({status,progress,updated_at:new Date().toISOString()}).eq("id",jobId);
  await supabase.from("job_logs").insert({generation_job_id:jobId,level:"info",message});
}

async function generateSectionStep(input:WorkflowInput&{sectionId:string;ordinal:number;total:number}){
  "use step";
  const supabase=createServiceSupabase();
  const {data,error:sectionError}=await supabase.from("sections").select("*, chapter:chapters(*), book:books(*, reader_profiles(*), writing_styles(*), story_bibles(data), knowledge_maps(data))").eq("id",input.sectionId).single();
  if(sectionError)throw sectionError;
  const section=data as unknown as SectionContext;
  if(section.status==="COMPLETED"&&section.content_markdown)return;

  await supabase.from("sections").update({status:"GENERATING"}).eq("id",input.sectionId);
  const stepStart=Date.now();
  const {data:step}=await supabase.from("generation_steps").insert({generation_job_id:input.jobId,book_id:input.bookId,section_id:input.sectionId,step_type:"SECTION_GENERATE",status:"RUNNING",attempt:1,started_at:new Date().toISOString()}).select("id").single();

  try{
    const book=section.book;
    const reader=one(book.reader_profiles)??{};
    const style=one(book.writing_styles)??{};
    const storyBible=one(book.story_bibles)?.data??null;
    const knowledgeMap=one(book.knowledge_maps)?.data??null;
    const memory=await retrieveBookMemory(input.bookId,`${section.chapter.title}: ${section.goal??section.title}`,12);
    const {data:previousRows}=await supabase.from("sections").select("summary").eq("chapter_id",section.chapter_id).lt("position",section.position).order("position",{ascending:false}).limit(1);
    const previousSummary=previousRows?.[0]?.summary??undefined;

    let researchNotes="";
    if(section.research_needed){
      const research=await runResearch(section.title,section.goal??section.title);
      researchNotes=research.value.notes;
      for(const source of research.value.sources){
        await supabase.from("sources").upsert({book_id:input.bookId,url:source.url,title:source.title,source_type:source.sourceType,reliability:source.reliability,metadata:{sectionId:input.sectionId}},{onConflict:"book_id,url"});
      }
      await recordUsage(supabase,input.userId,input.bookId,"RESEARCH",research.usage);
    }

    const model=process.env.OPENAI_WRITER_MODEL??"gpt-5";
    let draft=await llm.generateStructured({
      model,schemaName:"section_draft",jsonSchema:sectionDraftJsonSchema as unknown as Record<string,unknown>,system:sectionWriterSystem(),
      prompt:sectionWriterPrompt({bookSummary:`${book.title} — ${book.subtitle??""}\n${book.idea}`,chapterTitle:section.chapter.title,chapterGoal:section.chapter.goal??"",sectionTitle:section.title,sectionGoal:section.goal??"",targetWords:section.target_words,readerProfile:reader,writingStyle:style,relevantMemory:memory.map(({content,memory_type,similarity})=>({content,memory_type,similarity})),previousSectionSummary:previousSummary,researchNotes,storyBible,knowledgeMap}),
      parse:value=>SectionDraftSchema.parse(value)
    });
    await recordUsage(supabase,input.userId,input.bookId,"SECTION_WRITE",draft.usage);

    const repetition=await highestRepetitionScore(input.bookId,draft.value.summary,input.sectionId);
    if(repetition>0.89){
      draft=await llm.generateStructured({
        model,schemaName:"section_draft_rewrite",jsonSchema:sectionDraftJsonSchema as unknown as Record<string,unknown>,
        system:`${sectionWriterSystem()}\nThe first draft overlaps too strongly with earlier material. Rewrite from a genuinely new angle while preserving established facts.`,
        prompt:sectionWriterPrompt({bookSummary:`${book.title} — ${book.idea}`,chapterTitle:section.chapter.title,chapterGoal:section.chapter.goal??"",sectionTitle:section.title,sectionGoal:section.goal??"",targetWords:section.target_words,readerProfile:reader,writingStyle:style,relevantMemory:memory,previousSectionSummary:previousSummary,researchNotes,storyBible,knowledgeMap}),
        parse:value=>SectionDraftSchema.parse(value)
      });
      await recordUsage(supabase,input.userId,input.bookId,"SECTION_REWRITE_REPETITION",draft.usage);
    }

    let continuityStatus:"not_run"|"clear"|"warning"|"conflict"="not_run";
    if(input.ordinal>1&&(book.book_family==="FICTION"||memory.length>=5)){
      const continuity=await auditContinuity({bookFamily:book.book_family,sectionTitle:draft.value.title,draftSummary:draft.value.summary,keyFacts:draft.value.keyFacts,relevantMemory:memory.map(({memory_type,content,similarity})=>({memory_type,content,similarity})),storyBible,knowledgeMap});
      continuityStatus=continuity.value.status;
      await recordUsage(supabase,input.userId,input.bookId,"CONTINUITY_CHECK",continuity.usage);
      for(const issue of continuity.value.issues.filter(issue=>issue.severity!=="low")){
        await addMemory({bookId:input.bookId,type:"CONTINUITY_ISSUE",content:`${issue.category}: ${issue.description}. Evidence: ${issue.evidence}. Fix: ${issue.recommendation}`,sourceSectionId:input.sectionId,metadata:{sectionId:input.sectionId,severity:issue.severity}});
      }
      if(continuity.value.status==="conflict")await supabase.from("job_logs").insert({generation_job_id:input.jobId,level:"warning",message:`Continuity conflict detected in ${draft.value.title}`,metadata:{sectionId:input.sectionId,issues:continuity.value.issues}});
    }

    const wordCount=draft.value.markdown.trim().split(/\s+/u).filter(Boolean).length;
    await supabase.from("sections").update({title:draft.value.title,content_markdown:draft.value.markdown,summary:draft.value.summary,word_count:wordCount,status:"COMPLETED",updated_at:new Date().toISOString()}).eq("id",input.sectionId);
    await addMemory({bookId:input.bookId,type:"SECTION_SUMMARY",content:draft.value.summary,sourceSectionId:input.sectionId,metadata:{sectionId:input.sectionId,chapterId:section.chapter_id,repetitionScore:repetition}});
    for(const fact of draft.value.keyFacts.slice(0,10))await addMemory({bookId:input.bookId,type:"IMPORTANT_FACT",content:fact,sourceSectionId:input.sectionId});
    for(const term of draft.value.newTerminology.slice(0,8))await addMemory({bookId:input.bookId,type:"TERMINOLOGY",content:`${term.term}: ${term.definition}`,sourceSectionId:input.sectionId});

    const progress=(input.ordinal/Math.max(input.total,1))*92;
    await Promise.all([
      supabase.from("books").update({status:"GENERATING",progress,current_section_id:input.sectionId}).eq("id",input.bookId),
      supabase.from("generation_jobs").update({status:"GENERATING",progress}).eq("id",input.jobId),
      supabase.from("generation_steps").update({status:"COMPLETED",finished_at:new Date().toISOString(),duration_ms:Date.now()-stepStart,output:{wordCount,repetition,continuityStatus}}).eq("id",step?.id)
    ]);
    await supabase.from("job_logs").insert({generation_job_id:input.jobId,level:"info",message:`Section ${input.ordinal}/${input.total} completed: ${draft.value.title}`,metadata:{sectionId:input.sectionId,wordCount,repetition,continuityStatus}});
  }catch(error){
    await Promise.all([
      supabase.from("sections").update({status:"FAILED"}).eq("id",input.sectionId),
      supabase.from("generation_steps").update({status:"FAILED",finished_at:new Date().toISOString(),duration_ms:Date.now()-stepStart,error_message:error instanceof Error?error.message:String(error)}).eq("id",step?.id)
    ]);
    throw error;
  }
}

const ResearchSchema=z.object({notes:z.string(),sources:z.array(z.object({title:z.string(),url:z.string().url(),sourceType:z.string(),reliability:z.number().min(0).max(1)}))});
const researchJsonSchema={type:"object",additionalProperties:false,required:["notes","sources"],properties:{notes:{type:"string"},sources:{type:"array",items:{type:"object",additionalProperties:false,required:["title","url","sourceType","reliability"],properties:{title:{type:"string"},url:{type:"string"},sourceType:{type:"string"},reliability:{type:"number",minimum:0,maximum:1}}}}}} as const;

async function runResearch(title:string,goal:string){
  return llm.generateStructured({model:process.env.OPENAI_RESEARCH_MODEL??"gpt-5",schemaName:"research_notes",jsonSchema:researchJsonSchema as unknown as Record<string,unknown>,system:"Research the requested book section with current web sources. Prefer government, international organizations, universities, peer-reviewed papers, official documentation, company primary sources, then reputable journalism. Return only URLs actually used and never invent a citation.",prompt:`Section: ${title}\nGoal: ${goal}\nReturn concise evidence notes and the primary sources used.`,webSearch:true,parse:value=>ResearchSchema.parse(value)});
}

async function globalReviewStep(input:WorkflowInput,operation:"GLOBAL_REVIEW"|"FINAL_REVIEW"){
  "use step";
  const supabase=createServiceSupabase();
  const [{data:book,error},{data:continuityMemories}]=await Promise.all([
    supabase.from("books").select("id,title,subtitle,idea,book_type,book_family,target_pages,target_words,reader_profiles(*),writing_styles(*),story_bibles(data),knowledge_maps(data),parts(id,title,position,chapters(id,title,goal,position,target_words,sections(id,title,goal,position,summary,word_count,target_words)))").eq("id",input.bookId).single(),
    supabase.from("book_memories").select("memory_type,content,metadata").eq("book_id",input.bookId).eq("memory_type","CONTINUITY_ISSUE").limit(100)
  ]);
  if(error||!book)throw error??new Error("Book not found for review");
  const response=await llm.generateStructured({
    model:process.env.OPENAI_REVIEWER_MODEL??"gpt-5",schemaName:"book_review",jsonSchema:reviewJsonSchema as unknown as Record<string,unknown>,
    system:"You are the final global editor for a complete book. Review structure, writing, readability, consistency, originality, depth, reader fit, repetition, design suitability, and fact reliability. Check Story Bible/Knowledge Map and continuity issue evidence. When an issue can be fixed in one section, put that exact section UUID in scope; otherwise use BOOK or the chapter UUID. Do not demand rewrites without concrete evidence.",
    prompt:JSON.stringify({book,continuityMemories}).slice(0,190000),parse:value=>ReviewSchema.parse(value)
  });
  await recordUsage(supabase,input.userId,input.bookId,operation,response.usage);
  await supabase.from("books").update({quality_scores:response.value.scores,quality_score:response.value.overallScore,progress:operation==="FINAL_REVIEW"?97:94}).eq("id",input.bookId);
  await supabase.from("book_reviews").insert({book_id:input.bookId,generation_job_id:input.jobId,review:{kind:operation,...response.value}});
}

async function getActionableReviewFixes(bookId:string){
  "use step";
  const supabase=createServiceSupabase();
  const [{data:reviewRow},{data:sections}]=await Promise.all([
    supabase.from("book_reviews").select("review").eq("book_id",bookId).order("created_at",{ascending:false}).limit(1).single(),
    supabase.from("sections").select("id").eq("book_id",bookId)
  ]);
  if(!reviewRow)return [] as ReviewIssue[];
  const raw=reviewRow.review as Record<string,unknown>;
  const parsed=ReviewSchema.safeParse(raw.kind?Object.fromEntries(Object.entries(raw).filter(([key])=>key!=="kind")):raw);
  if(!parsed.success)return [] as ReviewIssue[];
  const sectionIds=new Set((sections??[]).map(row=>row.id));
  return parsed.data.issues.filter(issue=>(issue.severity==="high"||issue.severity==="medium")&&sectionIds.has(issue.scope)).slice(0,12);
}

const RewriteSchema=z.object({markdown:z.string().min(100),summary:z.string().min(30)});
const rewriteJsonSchema={type:"object",additionalProperties:false,required:["markdown","summary"],properties:{markdown:{type:"string"},summary:{type:"string"}}} as const;

async function fixReviewIssueStep(input:WorkflowInput&{fix:ReviewIssue}){
  "use step";
  const supabase=createServiceSupabase();
  const {data,error}=await supabase.from("sections").select("id,book_id,title,content_markdown,chapter:chapters(title),book:books(title,idea)").eq("id",input.fix.scope).single();
  if(error||!data)return;
  const section=data as unknown as {id:string;book_id:string;title:string;content_markdown:string|null;chapter:Relation<{title:string}>;book:Relation<{title:string;idea:string}>};
  const chapter=one(section.chapter);const book=one(section.book);
  await supabase.from("revisions").insert({book_id:section.book_id,section_id:section.id,user_id:input.userId,revision_type:"GLOBAL_POLISH",title_before:section.title,content_before:section.content_markdown,instruction:input.fix.fixInstruction});
  const result=await llm.generateStructured({model:process.env.OPENAI_EDITOR_MODEL??"gpt-5",schemaName:"targeted_global_polish",jsonSchema:rewriteJsonSchema as unknown as Record<string,unknown>,system:"You are a surgical book editor. Fix only the specified concrete global-review problem. Preserve correct facts, established story continuity, tone, intent, and approximate length. Return the complete corrected section Markdown and a fresh summary.",prompt:`BOOK: ${book?.title??""}\nIDEA: ${book?.idea??""}\nCHAPTER: ${chapter?.title??""}\nSECTION: ${section.title}\nPROBLEM: ${input.fix.description}\nFIX: ${input.fix.fixInstruction}\n\nCURRENT MARKDOWN:\n${section.content_markdown??""}`,parse:value=>RewriteSchema.parse(value)});
  await recordUsage(supabase,input.userId,input.bookId,"GLOBAL_TARGETED_FIX",result.usage);
  const wordCount=result.value.markdown.trim().split(/\s+/u).filter(Boolean).length;
  await supabase.from("sections").update({content_markdown:result.value.markdown,summary:result.value.summary,word_count:wordCount}).eq("id",section.id);
  await addMemory({bookId:input.bookId,type:"SECTION_SUMMARY",content:result.value.summary,sourceSectionId:section.id,metadata:{sectionId:section.id,source:"GLOBAL_POLISH"}});
  await supabase.from("job_logs").insert({generation_job_id:input.jobId,level:"info",message:`Targeted global fix applied: ${section.title}`,metadata:{sectionId:section.id,issue:input.fix.description}});
}

async function composePagesStep(input:WorkflowInput){
  "use step";
  const supabase=createServiceSupabase();
  const result=await composeBookPages(input.bookId);
  await Promise.all([supabase.from("books").update({progress:99}).eq("id",input.bookId),supabase.from("generation_jobs").update({progress:99}).eq("id",input.jobId)]);
  await supabase.from("job_logs").insert({generation_job_id:input.jobId,level:"info",message:`Page composition completed: ${result.pageCount} pages using ${result.templateId}`});
}

async function finalizeBook(input:WorkflowInput){
  "use step";
  const supabase=createServiceSupabase();
  await Promise.all([
    supabase.from("books").update({status:"COMPLETED",progress:100,completed_at:new Date().toISOString()}).eq("id",input.bookId),
    supabase.from("generation_jobs").update({status:"COMPLETED",progress:100,finished_at:new Date().toISOString()}).eq("id",input.jobId)
  ]);
  await supabase.from("job_logs").insert({generation_job_id:input.jobId,level:"info",message:"Book generation completed"});
}

async function failWorkflowStep(input:WorkflowInput,reason:string){
  "use step";
  const supabase=createServiceSupabase();
  await Promise.all([
    supabase.from("books").update({status:"FAILED"}).eq("id",input.bookId).neq("status","CANCELLED"),
    supabase.from("generation_jobs").update({status:"FAILED",failure_reason:reason,finished_at:new Date().toISOString()}).eq("id",input.jobId)
  ]);
  await supabase.from("job_logs").insert({generation_job_id:input.jobId,level:"error",message:"Generation workflow failed",metadata:{reason}});
}

async function recordUsage(supabase:ReturnType<typeof createServiceSupabase>,userId:string,bookId:string,operation:string,usage:ModelUsage){
  await supabase.from("token_usage").insert({user_id:userId,book_id:bookId,operation,model:usage.model,input_tokens:usage.inputTokens,output_tokens:usage.outputTokens,estimated_cost:estimateOpenAICost(usage.model,usage.inputTokens,usage.outputTokens),duration_ms:usage.durationMs,retry_count:0,provider_request_id:usage.requestId??null});
}
