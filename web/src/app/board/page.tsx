import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BoardClient } from "@/components/BoardClient";
import { isAdmin } from "@/lib/auth";
import { listMissionDays } from "@/lib/missions";
import { getSessionPerson } from "@/lib/session";

export default async function BoardPage() {
  const session = await getSessionPerson();
  if (!session) {
    redirect("/login?next=/board");
  }

  const admin = await isAdmin();
  const missions = await listMissionDays(true);

  return (
    <AppShell title="רשימה מלאה">
      <BoardClient
        personName={session.person.name}
        initialMissions={missions}
        isAdmin={admin}
      />
    </AppShell>
  );
}
