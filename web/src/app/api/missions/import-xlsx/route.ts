import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { lockFilledSeats } from "@/lib/assignment-lock";
import { parseLuachXlsx } from "@/lib/luach-xlsx-import";
import { deleteMissionDay, listMissionDays, saveMissionDay } from "@/lib/missions";
import { fetchActivePeople } from "@/lib/people";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "יש לבחור קובץ xlsx" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "הקובץ גדול מדי" }, { status: 400 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const supabase = await createClient();
  const people = await fetchActivePeople(supabase).catch(() => []);
  const rosterNames = people.map((p) => p.name);

  let draft;
  try {
    draft = parseLuachXlsx(bytes, rosterNames);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "לא הצלחתי לקרוא את הקובץ" },
      { status: 400 },
    );
  }

  const existing = (await listMissionDays(false))
    .filter((m) => m.mission_date === draft.mission_date && m.mission_type === "guards")
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const target = existing[0];
  const bundleId = target?.scheduling_rules?.guard_day_bundle_id || crypto.randomUUID();
  const leftoverLinkedId = target?.scheduling_rules?.linked_mission_id;

  const payload = {
    id: target?.id,
    title: draft.title,
    mission_type: draft.mission_type as const,
    mission_date: draft.mission_date,
    starts_at: draft.starts_at,
    ends_at: draft.ends_at,
    status: target?.status === "published" ? ("published" as const) : ("draft" as const),
    positions: draft.positions,
    assignments: draft.assignments,
    locked_seats: lockFilledSeats(draft.positions, draft.assignments),
    scheduling_rules: {
      ...draft.scheduling_rules,
      guard_day_bundle_id: bundleId,
      linked_mission_id: undefined,
    },
    notes: draft.notes,
  };

  try {
    let saved;
    try {
      ({ mission: saved } = await saveMissionDay(payload));
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (!msg.includes("שיבוץ לא תקין")) throw e;
      ({ mission: saved } = await saveMissionDay(payload, { validateAssignments: false }));
    }

    if (leftoverLinkedId && leftoverLinkedId !== saved.id) {
      await deleteMissionDay(leftoverLinkedId).catch(() => undefined);
    }

    return NextResponse.json(
      {
        mission: saved,
        assignedSeatCount: draft.assignedSeatCount,
        unmatchedNames: draft.unmatchedNames,
        replaced: Boolean(target),
      },
      { status: target ? 200 : 201 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה בייבוא" },
      { status: 500 },
    );
  }
}
