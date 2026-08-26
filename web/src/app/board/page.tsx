import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BoardClient } from "@/components/BoardClient";
import { isAdmin } from "@/lib/auth";
import { loadApprovedIssues } from "@/lib/issues";
import { listMissionDays } from "@/lib/missions";
import { fetchActivePeople } from "@/lib/people";
import { createClient } from "@/lib/supabase/server";
import { getAuthSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function BoardPage() {
  const authSession = await getAuthSession();
  if (!authSession) {
    redirect("/login?next=/board");
  }

  const admin = await isAdmin();
  const missions = await listMissionDays(!admin);

  const supabase = await createClient();
  const [initialPeople, initialApprovedIssues] = await Promise.all([
    fetchActivePeople(supabase),
    admin ? loadApprovedIssues() : Promise.resolve([]),
  ]);

  return (
    <AppShell title="רשימה מלאה">
      <BoardClient
        personName={authSession.person?.name ?? ""}
        canAssign={authSession.person !== null}
        viewerEmail={authSession.person ? undefined : authSession.user.email}
        initialMissions={missions}
        isAdmin={admin}
        initialPeople={initialPeople}
        initialApprovedIssues={initialApprovedIssues}
      />
    </AppShell>
  );
}
