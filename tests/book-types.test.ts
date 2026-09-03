import test from "node:test";
import assert from "node:assert/strict";
import { computeWordBudget, getBookTypeRule, planBookLength } from "../lib/book-types/engine";

test("education books get age-aware non-fiction engine",()=>{const rule=getBookTypeRule("교육용");assert.equal(rule.family,"EDUCATION");assert.equal(rule.citationDefault,"light");});
test("fiction uses lower page word density than business",()=>{assert.ok(computeWordBudget(100,"SF 미스터리")<computeWordBudget(100,"비즈니스 / 창업"));});
test("long book budgets scale hierarchically after reserving final-book front matter",()=>{const plan=planBookLength(300,"AI / 실용서");assert.equal(plan.contentPages,298);assert.equal(computeWordBudget(300,"AI / 실용서"),298*330);});
