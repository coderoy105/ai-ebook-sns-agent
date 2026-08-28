import test from "node:test";
import assert from "node:assert/strict";
import { ReaderProfileSchema, SectionDraftSchema } from "../lib/ai/schemas";

test("reader profile rejects out of range complexity",()=>{const result=ReaderProfileSchema.safeParse({ageGroup:"teen",knowledgeLevel:"beginner",readingPurpose:"learn",preferredComplexity:20,tonePreference:"friendly",technicalTolerance:4,examplePreference:"concrete",readingSpeed:"average"});assert.equal(result.success,false);});
test("section draft requires substantial manuscript",()=>{const result=SectionDraftSchema.safeParse({title:"A",markdown:"short",summary:"also short",keyFacts:[],claims:[],newTerminology:[],openThreads:[],resolvedThreads:[]});assert.equal(result.success,false);});
