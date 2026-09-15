import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { BoardClient } from "@/components/BoardClient";
import { isAdmin } from "@/lib/auth";
import { loadApprovedIssues } from "@/lib/issues";
import { listMissionDays, listVisibleMissionDays } from "@/lib/missions";
import { fetchActivePeople } from "@/lib/people";
import { createClient } from "@/lib/supabase/server";
import { getAuthSession } from "@/lib/session";

export const dynamic = "force-dynamic";

type BoardPageProps = {
  searchParams: Promise<{ date?: string; mission?: string }>;
};

export default async function BoardPage({ searchParams }: BoardPageProps) {
  const authSession = await getAuthSession();
  if (!authSession) {
    redirect("/login?next=/board");
  }

  const sp = await searchParams;
  const admin = await isAdmin();
  const focusMissionId = admin ? sp.mission?.trim() : undefined;
  const initialDate = sp.date?.slice(0, 10);
  const missions = admin
    ? await listMissionDays(false)
    : await listVisibleMissionDays();

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
        initialDate={initialDate}
        focusMissionId={focusMissionId}
        isAdmin={admin}
        initialPeople={initialPeople}
        initialApprovedIssues={initialApprovedIssues}
      />
    </AppShell>
  );
}
