import type { BackgroundExportInput } from "@/lib/export/background";

type PdfPlan =
  | { status: "completed"; assetId: string; chapterCount: number }
  | { status: "ready"; chapterCount: number };

export async function generateBookExportWorkflow(input: BackgroundExportInput) {
  "use workflow";

  try {
    if (input.format === "pdf") {
      const plan = await preparePdfStep(input) as PdfPlan;
      if (plan.status === "completed") return plan;

      await renderPdfFrontStep(input);
      for (let chapterIndex = 0; chapterIndex < plan.chapterCount; chapterIndex += 1) {
        await renderPdfChapterStep(input, chapterIndex, plan.chapterCount);
      }
      return finalizePdfStep(input, plan.chapterCount);
    }

    return runExportStep(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await failExportStep(input, message);
    throw new Error(message);
  }
}

async function preparePdfStep(input: BackgroundExportInput) {
  "use step";
  const { prepareBackgroundPdfExport } = await import("@/lib/export/background");
  return prepareBackgroundPdfExport(input);
}

async function renderPdfFrontStep(input: BackgroundExportInput) {
  "use step";
  const { renderBackgroundPdfFront } = await import("@/lib/export/background");
  return renderBackgroundPdfFront(input);
}

async function renderPdfChapterStep(input: BackgroundExportInput, chapterIndex: number, chapterCount: number) {
  "use step";
  const { renderBackgroundPdfChapter } = await import("@/lib/export/background");
  return renderBackgroundPdfChapter(input, chapterIndex, chapterCount);
}

async function finalizePdfStep(input: BackgroundExportInput, chapterCount: number) {
  "use step";
  const { finalizeBackgroundPdfExport } = await import("@/lib/export/background");
  return finalizeBackgroundPdfExport(input, chapterCount);
}

async function runExportStep(input: BackgroundExportInput) {
  "use step";
  const { generateAndPersistBookExport } = await import("@/lib/export/background");
  return generateAndPersistBookExport(input);
}

async function failExportStep(input: BackgroundExportInput, message: string) {
  "use step";
  const { markBackgroundExportFailed } = await import("@/lib/export/background");
  await markBackgroundExportFailed(input, message);
}
