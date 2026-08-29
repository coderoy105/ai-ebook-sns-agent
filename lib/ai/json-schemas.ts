const titleCandidateJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title","subtitle","style","reason","targetReaction"],
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    style: { type: "string" },
    reason: { type: "string" },
    targetReaction: { type: "string" }
  }
} as const;

const sectionPlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title","goal","targetWords","researchNeeded","layoutHint"],
  properties: {
    title: { type: "string" },
    goal: { type: "string" },
    targetWords: { type: "integer", minimum: 100 },
    researchNeeded: { type: "boolean" },
    layoutHint: { type: "string" }
  }
} as const;

const chapterSkeletonJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title","goal","targetWords","dependencies"],
  properties: {
    title: { type: "string" },
    goal: { type: "string" },
    targetWords: { type: "integer", minimum: 200 },
    dependencies: { type: "array", items: { type: "string" } }
  }
} as const;

export const bookBlueprintSkeletonJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["titleCandidates","selectedTitle","selectedSubtitle","bookGoal","coreMessage","targetReader","readerBeforeState","readerAfterState","differentiation","expectedPages","expectedWords","bookType","templateRecommendations","parts","storyBible","knowledgeMap"],
  properties: {
    titleCandidates: { type: "array", minItems: 5, maxItems: 7, items: titleCandidateJsonSchema },
    selectedTitle: { type: "string" },
    selectedSubtitle: { type: "string" },
    bookGoal: { type: "string" },
    coreMessage: { type: "string" },
    targetReader: { type: "string" },
    readerBeforeState: { type: "string" },
    readerAfterState: { type: "string" },
    differentiation: { type: "string" },
    expectedPages: { type: "integer", minimum: 1 },
    expectedWords: { type: "integer", minimum: 1000 },
    bookType: { type: "string" },
    templateRecommendations: { type: "array", minItems: 1, maxItems: 3, items: { type: "string" } },
    parts: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title","purpose","chapters"],
        properties: {
          title: { type: "string" },
          purpose: { type: "string" },
          chapters: { type: "array", minItems: 1, items: chapterSkeletonJsonSchema }
        }
      }
    },
    storyBible: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] },
    knowledgeMap: { anyOf: [{ type: "object", additionalProperties: true }, { type: "null" }] }
  }
} as const;

export const chapterSectionsJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["sections"],
  properties: {
    sections: { type: "array", minItems: 1, maxItems: 8, items: sectionPlanJsonSchema }
  }
} as const;

export const bookBlueprintJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["titleCandidates","selectedTitle","selectedSubtitle","bookGoal","coreMessage","targetReader","readerBeforeState","readerAfterState","differentiation","expectedPages","expectedWords","bookType","templateRecommendations","parts","storyBible","knowledgeMap"],
  properties: {
    ...bookBlueprintSkeletonJsonSchema.properties,
    parts: {
      type: "array", minItems: 1,
      items: {
        type: "object", additionalProperties: false, required: ["title","purpose","chapters"],
        properties: {
          title: { type: "string" }, purpose: { type: "string" },
          chapters: {
            type: "array", minItems: 1,
            items: {
              type: "object", additionalProperties: false, required: ["title","goal","targetWords","dependencies","sections"],
              properties: {
                ...chapterSkeletonJsonSchema.properties,
                sections: { type: "array", minItems: 1, items: sectionPlanJsonSchema }
              }
            }
          }
        }
      }
    }
  }
} as const;

export const sectionDraftJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["title","markdown","summary","keyFacts","claims","newTerminology","openThreads","resolvedThreads"],
  properties: {
    title: { type: "string" },
    markdown: { type: "string" },
    summary: { type: "string" },
    keyFacts: { type: "array", items: { type: "string" } },
    claims: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["claim","sourceUrl","confidence"],
        properties: {
          claim: { type: "string" },
          sourceUrl: { anyOf: [{ type: "string" }, { type: "null" }] },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        }
      }
    },
    newTerminology: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["term","definition"],
        properties: { term: { type: "string" }, definition: { type: "string" } }
      }
    },
    openThreads: { type: "array", items: { type: "string" } },
    resolvedThreads: { type: "array", items: { type: "string" } }
  }
} as const;

export const reviewJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["overallScore","scores","issues"],
  properties: {
    overallScore: { type: "number", minimum: 0, maximum: 100 },
    scores: {
      type: "object", additionalProperties: false,
      required: ["structure","writing","readability","consistency","originality","depth","readerFit","repetition","design","factReliability"],
      properties: Object.fromEntries(["structure","writing","readability","consistency","originality","depth","readerFit","repetition","design","factReliability"].map((key) => [key, { type: "number", minimum: 0, maximum: 100 }]))
    },
    issues: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["severity","scope","description","fixInstruction"],
        properties: {
          severity: { type: "string", enum: ["low","medium","high"] },
          scope: { type: "string" }, description: { type: "string" }, fixInstruction: { type: "string" }
        }
      }
    }
  }
} as const;
