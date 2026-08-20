import { Suspense } from "react";
import { MissionEditor } from "@/components/MissionEditor";
import { AppShell } from "@/components/AppShell";

export default function NewMissionPage() {
  return (
    <AppShell title="יום משימה חדש">
      <main className="mx-auto max-w-3xl px-5 py-8">
        <Suspense fallback={<p className="hint p-5">טוען…</p>}>
          <MissionEditor />
        </Suspense>
      </main>
    </AppShell>
  );
}
