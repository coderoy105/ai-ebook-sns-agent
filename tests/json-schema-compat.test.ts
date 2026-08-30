import assert from "node:assert/strict";
import test from "node:test";
import {
  bookBlueprintJsonSchema,
  bookBlueprintSkeletonJsonSchema,
  chapterSectionsJsonSchema,
  reviewJsonSchema,
  sectionDraftJsonSchema
} from "../lib/ai/json-schemas";

function walkSchema(value: unknown, path = "$"): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkSchema(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const type = record.type;
  if (type === "object") {
    assert.equal(record.additionalProperties, false, `${path} must set additionalProperties=false`);
    assert.ok(record.properties && typeof record.properties === "object", `${path} must define properties`);
    assert.ok(Array.isArray(record.required), `${path} must define required fields`);
  }

  for (const [key, child] of Object.entries(record)) {
    if (key === "examples" || key === "description") continue;
    walkSchema(child, `${path}.${key}`);
  }
}

test("AI structured-output schemas do not contain arbitrary object hashes", () => {
  for (const schema of [
    bookBlueprintSkeletonJsonSchema,
    bookBlueprintJsonSchema,
    chapterSectionsJsonSchema,
    sectionDraftJsonSchema,
    reviewJsonSchema
  ]) {
    walkSchema(schema);
  }
});

test("blueprint memory containers have fixed strict fields", () => {
  const properties = bookBlueprintSkeletonJsonSchema.properties;
  for (const key of ["storyBible", "knowledgeMap"] as const) {
    const memory = properties[key];
    assert.equal(memory.type, "object");
    assert.equal(memory.additionalProperties, false);
    assert.deepEqual(memory.required, ["summary", "facts", "entities", "constraints"]);
  }
});
