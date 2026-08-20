import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import {
  defaultGuardDayPositions,
  emptyAssignments,
  listMissionDays,
  newPosition,
  normalizeSchedulingRules,
  saveMissionDay,
} from "@/lib/missions";
import { DEFAULT_MISSION_SCHEDULING_RULES } from "@/lib/types";
import type { MissionType } from "@/lib/types";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const publishedOnly = searchParams.get("published") === "1";
  const admin = await isAdmin();

  try {
    const all = await listMissionDays(false);
    if (admin && !publishedOnly) {
      return NextResponse.json(all);
    }
    return NextResponse.json(all.filter((m) => m.status === "published"));
  } catch (e) {
    const msg = e instanceof Error ? e.message : "שגיאה";
    if (msg.includes("mission_days")) return NextResponse.json([]);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const body = await request.json();
  const mission_type = body.mission_type as MissionType;
  if (!["guards", "base_work", "kitchen"].includes(mission_type)) {
    return NextResponse.json({ error: "סוג משימה לא תקין" }, { status: 400 });
  }

  const mission_date = String(body.mission_date || "").slice(0, 10);
  const starts_at = String(body.starts_at || "");
  const ends_at = String(body.ends_at || "");
  const title =
    String(body.title || "").trim() ||
    `${mission_date} · ${mission_type === "guards" ? "שמירות" : mission_type === "kitchen" ? "מטבח" : "עב״ס"}`;

  if (!mission_date || !starts_at || !ends_at) {
    return NextResponse.json({ error: "חסרים תאריך או שעות" }, { status: 400 });
  }

  let positions = body.positions;
  if (!positions?.length) {
    const rules = normalizeSchedulingRules(
      body.scheduling_rules ?? DEFAULT_MISSION_SCHEDULING_RULES,
    );
    positions =
      mission_type === "guards"
        ? defaultGuardDayPositions({
            shiftHours: rules.shift_hours,
            boardStart: rules.board_start,
          })
        : [
            newPosition(
              mission_type === "kitchen" ? "משמרות מטבח" : "משמרות עב״ס",
              { kind: mission_type === "kitchen" ? "kitchen" : "duty" },
            ),
          ];
  }

  const scheduling_rules = normalizeSchedulingRules(
    body.scheduling_rules ?? DEFAULT_MISSION_SCHEDULING_RULES,
  );

  try {
    const saved = await saveMissionDay({
      title,
      mission_type,
      mission_date,
      starts_at,
      ends_at,
      status: body.status === "published" ? "published" : "draft",
      positions,
      assignments: emptyAssignments(positions),
      scheduling_rules,
      notes: body.notes || null,
    });
    return NextResponse.json(saved, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "שגיאה";
    if (msg.includes("mission_days")) {
      return NextResponse.json(
        { error: "הריצו supabase/migration_mission_days.sql" },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
