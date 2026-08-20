import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { probePeopleSquad } from "@/lib/people";
import squadRoster from "@/data/squad-roster.json";

type SquadEntry = {
  name: string;
  db_name?: string | null;
  email: string;
  squad: number;
  squad_label?: string;
};

export async function POST() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const supabase = await createClient();
  const hasSquad = await probePeopleSquad(supabase);
  if (!hasSquad) {
    return NextResponse.json(
      {
        error: "עמודת squad חסרה — הריצו קודם את supabase/migration_squad.sql",
      },
      { status: 500 },
    );
  }

  const { data: existing, error: listErr } = await supabase
    .from("people")
    .select("id,name,email,squad");
  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }

  const byEmail = new Map(
    (existing || [])
      .filter((p) => p.email)
      .map((p) => [String(p.email).toLowerCase(), p as { id: string; name: string }]),
  );
  const byName = new Map(
    (existing || []).map((p) => [p.name, p as { id: string; name: string }]),
  );

  let updated = 0;
  const errors: string[] = [];
  const squadCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };

  for (const entry of (squadRoster as { people: SquadEntry[] }).people) {
    const email = entry.email.trim().toLowerCase();
    const row =
      byEmail.get(email) ||
      (entry.db_name ? byName.get(entry.db_name) : undefined) ||
      byName.get(entry.name);

    if (!row) {
      errors.push(`${entry.name}: לא נמצא במאגר`);
      continue;
    }

    const { error } = await supabase
      .from("people")
      .update({ squad: entry.squad })
      .eq("id", row.id);

    if (error) {
      errors.push(`${entry.name}: ${error.message}`);
      continue;
    }
    updated += 1;
    squadCounts[entry.squad] = (squadCounts[entry.squad] || 0) + 1;
  }

  return NextResponse.json({
    ok: errors.length === 0,
    total: (squadRoster as { people: SquadEntry[] }).people.length,
    updated,
    squadCounts,
    squads: (squadRoster as { squads: string[] }).squads,
    errors,
  });
}
