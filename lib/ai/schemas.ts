import { z } from "zod";

export const ReaderProfileSchema = z.object({
  ageGroup: z.string(),
  knowledgeLevel: z.enum(["beginner", "intermediate", "advanced", "expert"]),
  readingPurpose: z.string(),
  preferredComplexity: z.number().min(1).max(10),
  tonePreference: z.string(),
  technicalTolerance: z.number().min(1).max(10),
  examplePreference: z.string(),
  readingSpeed: z.enum(["slow", "average", "fast"])
});

export const WritingStyleSchema = z.object({
  label: z.string(),
  description: z.string(),
  sentenceLength: z.number().min(1).max(10),
  descriptionDepth: z.number().min(1).max(10),
  emotionLevel: z.number().min(1).max(10),
  technicalVocabulary: z.number().min(1).max(10),
  dialogueRatio: z.number().min(0).max(100),
  narrativeSpeed: z.number().min(1).max(10)
});

export const SectionPlanSchema = z.object({
  title: z.string(),
  goal: z.string(),
  targetWords: z.number().int().positive(),
  researchNeeded: z.boolean(),
  layoutHint: z.string()
});

export const ChapterSectionsSchema = z.object({
  sections: z.array(SectionPlanSchema).min(1)
});

export const ChapterSkeletonSchema = z.object({
  title: z.string(),
  goal: z.string(),
  targetWords: z.number().int().positive(),
  dependencies: z.array(z.string())
});

export const PartSkeletonSchema = z.object({
  title: z.string(),
  purpose: z.string(),
  chapters: z.array(ChapterSkeletonSchema).min(1)
});

const TitleCandidateSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  style: z.string(),
  reason: z.string(),
  targetReaction: z.string()
});

export const BookBlueprintSkeletonSchema = z.object({
  titleCandidates: z.array(TitleCandidateSchema).min(5),
  selectedTitle: z.string(),
  selectedSubtitle: z.string(),
  bookGoal: z.string(),
  coreMessage: z.string(),
  targetReader: z.string(),
  readerBeforeState: z.string(),
  readerAfterState: z.string(),
  differentiation: z.string(),
  expectedPages: z.number().int().positive(),
  expectedWords: z.number().int().positive(),
  bookType: z.string(),
  templateRecommendations: z.array(z.string()).min(1),
  parts: z.array(PartSkeletonSchema).min(1),
  storyBible: z.record(z.string(), z.unknown()).nullable(),
  knowledgeMap: z.record(z.string(), z.unknown()).nullable()
});

const ChapterPlanSchema = ChapterSkeletonSchema.extend({
  sections: z.array(SectionPlanSchema).min(1)
});

const PartPlanSchema = z.object({
  title: z.string(),
  purpose: z.string(),
  chapters: z.array(ChapterPlanSchema).min(1)
});

export const BookBlueprintSchema = BookBlueprintSkeletonSchema.extend({
  parts: z.array(PartPlanSchema).min(1)
});

export const SectionDraftSchema = z.object({
  title: z.string(),
  markdown: z.string().min(100),
  summary: z.string().min(30),
  keyFacts: z.array(z.string()),
  claims: z.array(z.object({
    claim: z.string(),
    sourceUrl: z.string().url().nullable(),
    confidence: z.number().min(0).max(1)
  })),
  newTerminology: z.array(z.object({
    term: z.string(),
    definition: z.string()
  })),
  openThreads: z.array(z.string()),
  resolvedThreads: z.array(z.string())
});

export const ReviewSchema = z.object({
  overallScore: z.number().min(0).max(100),
  scores: z.object({
    structure: z.number().min(0).max(100),
    writing: z.number().min(0).max(100),
    readability: z.number().min(0).max(100),
    consistency: z.number().min(0).max(100),
    originality: z.number().min(0).max(100),
    depth: z.number().min(0).max(100),
    readerFit: z.number().min(0).max(100),
    repetition: z.number().min(0).max(100),
    design: z.number().min(0).max(100),
    factReliability: z.number().min(0).max(100)
  }),
  issues: z.array(z.object({
    severity: z.enum(["low", "medium", "high"]),
    scope: z.string(),
    description: z.string(),
    fixInstruction: z.string()
  }))
});

export type BookBlueprintSkeleton = z.infer<typeof BookBlueprintSkeletonSchema>;
export type ChapterSections = z.infer<typeof ChapterSectionsSchema>;
export type BookBlueprint = z.infer<typeof BookBlueprintSchema>;
export type SectionDraft = z.infer<typeof SectionDraftSchema>;
