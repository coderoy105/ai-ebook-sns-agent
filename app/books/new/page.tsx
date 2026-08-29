import { AppShell } from "@/components/app-shell";
import { BookWizard } from "./book-wizard";
import { CodexUsageStatus } from "./codex-usage-status";

export default function NewBookPage() {
  return (
    <AppShell>
      <CodexUsageStatus />
      <BookWizard />
    </AppShell>
  );
}
