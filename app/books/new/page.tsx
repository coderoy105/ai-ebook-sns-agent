import { AppShell } from "@/components/app-shell";
import { BookWizard } from "./book-wizard";

export default function NewBookPage() {
  return (
    <AppShell>
      <BookWizard />
    </AppShell>
  );
}
