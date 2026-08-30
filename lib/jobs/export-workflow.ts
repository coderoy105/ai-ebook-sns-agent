import type { BackgroundExportInput } from "@/lib/export/background";

export async function generateBookExportWorkflow(input: BackgroundExportInput) {
  "use workflow";
  return runExportStep(input);
}

async function runExportStep(input: BackgroundExportInput) {
  "use step";
  const { generateAndPersistBookExport } = await import("@/lib/export/background");
  return generateAndPersistBookExport(input);
}
