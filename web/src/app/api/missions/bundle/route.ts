import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { createGuardDayBundle } from "@/lib/guard-day-bundle";

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const mission_date = String(body.mission_date || new Date().toISOString().slice(0, 10)).slice(
    0,
    10,
  );

  try {
    const result = await createGuardDayBundle({
      mission_date,
      guard_starts_at: body.guard_starts_at || undefined,
      guard_ends_at: body.guard_ends_at || undefined,
      title: body.title || undefined,
      status: body.status === "published" ? "published" : "draft",
      scheduling: body.scheduling_rules || undefined,
    });

    return NextResponse.json(
      {
        bundle_id: result.bundleId,
        guards: result.guards,
      },
      { status: 201 },
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }
}
