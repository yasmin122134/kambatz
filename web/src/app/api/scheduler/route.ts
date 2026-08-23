import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ISSUE_TYPE_LABELS, type Issue, type IssueType } from "@/lib/types";
import {
  PEOPLE_BASE_SELECT,
  PEOPLE_FLAG_SELECT,
  peopleToSchedulerList,
  probePeopleFlags,
  schedulerPersonToDb,
  type SchedulerPersonPayload,
} from "@/lib/people";

type SchedulerSnapshot = {
  jobs?: unknown[];
  cfg?: Record<string, unknown>;
  locks?: Record<string, unknown>;
  patrols?: unknown[];
  rooms?: unknown[];
  trials?: unknown[];
  cutoff?: number | null;
  result?: unknown;
};

function approvedIssueToTrial(issue: Issue) {
  const label = ISSUE_TYPE_LABELS[issue.issue_type as IssueType];
  const name =
    [label, issue.note].filter(Boolean).join(" | ") || issue.person_name;
  return {
    id: `issue-${issue.id}`,
    name,
    start: issue.start_time,
    end: issue.end_time,
    count: 1,
    who: [issue.person_name],
    _fromIssue: true,
  };
}

function mergeTrials(manual: unknown[], approved: Issue[]) {
  const manualOnly = (manual || []).filter(
    (t) => !(t as { id?: string }).id?.startsWith("issue-"),
  );
  return [...manualOnly, ...approved.map(approvedIssueToTrial)];
}

async function fetchPeople(supabase: Awaited<ReturnType<typeof createClient>>) {
  const withFlags = await probePeopleFlags(supabase);
  const select = withFlags
    ? `${PEOPLE_BASE_SELECT},${PEOPLE_FLAG_SELECT}`
    : PEOPLE_BASE_SELECT;
  const { data, error } = await supabase
    .from("people")
    .select(select)
    .eq("active", true)
    .order("name");
  return { data: data || [], error, withFlags };
}

export async function GET() {
  const supabase = await createClient();

  const peopleResult = await fetchPeople(supabase);
  if (peopleResult.error) {
    return NextResponse.json({ error: peopleResult.error.message }, { status: 500 });
  }

  const [stateRes, issuesRes] = await Promise.all([
    supabase.from("scheduler_state").select("state, updated_at").eq("id", 1).maybeSingle(),
    supabase.from("issues").select("*").eq("status", "approved").order("created_at"),
  ]);

  if (issuesRes.error) {
    return NextResponse.json({ error: issuesRes.error.message }, { status: 500 });
  }

  const stateMissing =
    stateRes.error?.code === "PGRST205" ||
    stateRes.error?.message?.includes("scheduler_state");

  if (stateRes.error && !stateMissing) {
    return NextResponse.json({ error: stateRes.error.message }, { status: 500 });
  }

  const rawState = (stateRes.data?.state || {}) as SchedulerSnapshot;
  const approved = (issuesRes.data || []) as Issue[];
  const people = peopleToSchedulerList(
    peopleResult.data as unknown as Record<string, unknown>[],
  );

  return NextResponse.json({
    updated_at: stateRes.data?.updated_at ?? null,
    people,
    state: {
      jobs: rawState.jobs ?? [],
      cfg: rawState.cfg ?? {},
      locks: rawState.locks ?? {},
      patrols: rawState.patrols ?? [],
      rooms: rawState.rooms ?? [],
      trials: mergeTrials(rawState.trials ?? [], approved),
      cutoff: rawState.cutoff ?? null,
      result: rawState.result ?? null,
    },
    meta: {
      stateReady: !stateMissing,
      peopleCount: people.length,
    },
  });
}

export async function PUT(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const body = await request.json();
  const people = (body.people || []) as SchedulerPersonPayload[];
  const incoming = (body.state || {}) as SchedulerSnapshot;

  const supabase = await createClient();
  const withFlags = await probePeopleFlags(supabase);

  const manualTrials = (incoming.trials || []).filter(
    (t) => !(t as { id?: string }).id?.startsWith("issue-"),
  );

  const stateToSave = {
    jobs: incoming.jobs ?? [],
    cfg: incoming.cfg ?? {},
    locks: incoming.locks ?? {},
    patrols: incoming.patrols ?? [],
    rooms: incoming.rooms ?? [],
    trials: manualTrials,
    cutoff: incoming.cutoff ?? null,
    result: incoming.result ?? null,
  };

  for (const person of people) {
    const row = schedulerPersonToDb(person, withFlags);
    if (!row.name) continue;

    const { error } = await supabase.from("people").upsert(row, { onConflict: "name" });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const { data, error } = await supabase
    .from("scheduler_state")
    .upsert({ id: 1, state: stateToSave, updated_at: new Date().toISOString() })
    .select("updated_at")
    .single();

  if (error) {
    const missing =
      error.code === "PGRST205" || error.message.includes("scheduler_state");
    if (missing) {
      return NextResponse.json({
        ok: true,
        updated_at: null,
        warning:
          "המחזור נשמר — הריצו supabase/migration_scheduler.sql כדי לשמור גם לוח וחסימות",
      });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, updated_at: data.updated_at });
}
