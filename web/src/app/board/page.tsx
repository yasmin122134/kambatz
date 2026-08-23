import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BoardClient } from "@/components/BoardClient";
import { isAdmin } from "@/lib/auth";
import { loadApprovedIssues } from "@/lib/issues";
import { listMissionDays } from "@/lib/missions";
import { fetchActivePeople } from "@/lib/people";
import { createClient } from "@/lib/supabase/server";
import { getSessionPerson } from "@/lib/session";

export default async function BoardPage() {
  const session = await getSessionPerson();
  if (!session) {
    redirect("/login?next=/board");
  }

  const admin = await isAdmin();
  const missions = await listMissionDays(!admin);

  let initialPeople: Awaited<ReturnType<typeof fetchActivePeople>> = [];
  let initialApprovedIssues: Awaited<ReturnType<typeof loadApprovedIssues>> = [];
  if (admin) {
    const supabase = await createClient();
    [initialPeople, initialApprovedIssues] = await Promise.all([
      fetchActivePeople(supabase),
      loadApprovedIssues(),
    ]);
  }

  return (
    <AppShell title="רשימה מלאה">
      <BoardClient
        personName={session.person.name}
        initialMissions={missions}
        isAdmin={admin}
        initialPeople={initialPeople}
        initialApprovedIssues={initialApprovedIssues}
      />
    </AppShell>
  );
}
