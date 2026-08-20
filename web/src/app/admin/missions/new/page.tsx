import { MissionEditor } from "@/components/MissionEditor";
import { AppShell } from "@/components/AppShell";

export default function NewMissionPage() {
  return (
    <AppShell title="יום משימה חדש">
      <main className="mx-auto max-w-3xl px-5 py-8">
        <MissionEditor />
      </main>
    </AppShell>
  );
}
