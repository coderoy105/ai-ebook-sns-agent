import { z } from "zod";
import { llm } from "@/lib/ai/openai";

export const ContinuityCheckSchema=z.object({
  status:z.enum(["clear","warning","conflict"]),
  issues:z.array(z.object({
    category:z.enum(["character","timeline","location","relationship","fact","terminology","reveal","world_rule","definition","number","other"]),
    severity:z.enum(["low","medium","high"]),
    description:z.string(),
    evidence:z.string(),
    recommendation:z.string()
  })),
  confidence:z.number().min(0).max(1)
});

const continuityJsonSchema={
  type:"object",additionalProperties:false,required:["status","issues","confidence"],
  properties:{
    status:{type:"string",enum:["clear","warning","conflict"]},
    issues:{type:"array",items:{type:"object",additionalProperties:false,required:["category","severity","description","evidence","recommendation"],properties:{
      category:{type:"string",enum:["character","timeline","location","relationship","fact","terminology","reveal","world_rule","definition","number","other"]},
      severity:{type:"string",enum:["low","medium","high"]},description:{type:"string"},evidence:{type:"string"},recommendation:{type:"string"}
    }}},confidence:{type:"number",minimum:0,maximum:1}
  }
} as const;

export async function auditContinuity(input:{
  bookFamily:string;
  sectionTitle:string;
  draftSummary:string;
  keyFacts:string[];
  relevantMemory:Array<{memory_type:string;content:string;similarity:number}>;
  storyBible:unknown;
  knowledgeMap:unknown;
}){
  const fiction=input.bookFamily==="FICTION";
  return llm.generateStructured({
    model:process.env.OPENAI_REVIEWER_MODEL??"gpt-5",
    schemaName:"continuity_check",
    jsonSchema:continuityJsonSchema as unknown as Record<string,unknown>,
    system:fiction
      ? "You are a fiction continuity editor. Detect only concrete contradictions involving character identity/age/status, relationships, locations, chronology, world rules, foreshadowing, reveals, and already-resolved story threads. Do not invent conflicts."
      : "You are a nonfiction continuity editor. Detect only concrete contradictions in definitions, terminology, numbers, claims, prerequisite order, and established facts. Do not flag healthy elaboration as inconsistency.",
    prompt:`SECTION: ${input.sectionTitle}\nDRAFT SUMMARY: ${input.draftSummary}\nKEY FACTS: ${JSON.stringify(input.keyFacts)}\nRELEVANT MEMORY: ${JSON.stringify(input.relevantMemory)}\nSTORY BIBLE: ${JSON.stringify(input.storyBible)}\nKNOWLEDGE MAP: ${JSON.stringify(input.knowledgeMap)}\n\nReturn a conflict only when evidence is specific enough to act on.`,
    parse:value=>ContinuityCheckSchema.parse(value)
  });
}
