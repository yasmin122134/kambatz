import { MissionEditor } from "@/components/MissionEditor";
import { AppShell } from "@/components/AppShell";

type Props = { params: Promise<{ id: string }> };

export default async function EditMissionPage({ params }: Props) {
  const { id } = await params;
  return (
    <AppShell title="עריכת משימה">
      <main className="mx-auto max-w-3xl px-5 py-8">
        <MissionEditor missionId={id} />
      </main>
    </AppShell>
  );
}
