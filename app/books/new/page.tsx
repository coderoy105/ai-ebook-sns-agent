import { AppShell } from "@/components/app-shell";
import { BookWizard } from "./book-wizard";
import { CodexUsageStatus } from "./codex-usage-status";
import templateStyles from "./template-enhancements.module.css";

export default function NewBookPage() {
  return (
    <AppShell>
      <CodexUsageStatus />
      <div className={templateStyles.scope}><BookWizard /></div>
    </AppShell>
  );
}
