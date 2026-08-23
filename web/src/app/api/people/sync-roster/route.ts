import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { DUTY_OFFICER_EMAILS } from "@/lib/officers";
import { createClient } from "@/lib/supabase/server";
import roster from "@/data/platoon-d-roster.json";

type RosterEntry = {
  name: string;
  db_name: string | null;
  email: string;
};

export async function POST() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const supabase = await createClient();
  const { error: probeErr } = await supabase
    .from("people")
    .select("email")
    .limit(1);
  if (probeErr) {
    return NextResponse.json(
      {
        error:
          "עמודת email חסרה — הריצו קודם את supabase/migration_email_auth.sql",
      },
      { status: 500 },
    );
  }

  const { data: existing, error: listErr } = await supabase
    .from("people")
    .select("id,name,email,room");
  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }

  const byName = new Map(
    (existing || []).map((p) => [p.name, p as { id: string; name: string; email?: string | null; room?: string | null }]),
  );
  const byEmail = new Map(
    (existing || [])
      .filter((p) => p.email)
      .map((p) => [String(p.email).toLowerCase(), p as { id: string; name: string; email?: string | null; room?: string | null }]),
  );

  let updated = 0;
  let inserted = 0;
  let deleted = 0;
  const errors: string[] = [];

  const rosterEntries = roster as RosterEntry[];
  const rosterEmails = new Set(
    rosterEntries.map((e) => e.email.trim().toLowerCase()),
  );
  const rosterNames = new Set(
    rosterEntries.flatMap((e) => [e.name, e.db_name].filter(Boolean) as string[]),
  );

  for (const entry of rosterEntries) {
    const email = entry.email.trim().toLowerCase();
    const isDutyOfficer = (DUTY_OFFICER_EMAILS as readonly string[]).includes(email);
    let row =
      byEmail.get(email) ||
      (entry.db_name ? byName.get(entry.db_name) : undefined) ||
      byName.get(entry.name);

    if (row) {
      const patch: Record<string, string | boolean> = { email };
      if (row.name !== entry.name) patch.name = entry.name;
      if (isDutyOfficer) {
        patch.is_admin = true;
        patch.is_officer = true;
      }

      const { error } = await supabase
        .from("people")
        .update(patch)
        .eq("id", row.id);
      if (error) {
        errors.push(`${entry.name}: ${error.message}`);
        continue;
      }
      updated += 1;
      byName.delete(row.name);
      byName.set(entry.name, { ...row, ...patch });
      byEmail.set(email, { ...row, ...patch });
      continue;
    }

    const insertRow: Record<string, string | boolean> = {
      name: entry.name,
      email,
      active: true,
    };
    if (isDutyOfficer) {
      insertRow.is_admin = true;
      insertRow.is_officer = true;
    }

    const { data, error } = await supabase
      .from("people")
      .insert(insertRow)
      .select("id,name,email")
      .single();
    if (error) {
      errors.push(`${entry.name}: ${error.message}`);
      continue;
    }
    inserted += 1;
    byName.set(data.name, data);
    byEmail.set(email, data);
  }

  for (const person of existing || []) {
    const email = person.email ? String(person.email).toLowerCase() : "";
    const inRoster =
      (email && rosterEmails.has(email)) || rosterNames.has(person.name);
    if (inRoster) continue;

    const { error } = await supabase.from("people").delete().eq("id", person.id);
    if (error) {
      errors.push(`${person.name} (מחיקה): ${error.message}`);
      continue;
    }
    deleted += 1;
  }

  return NextResponse.json({
    ok: errors.length === 0,
    total: rosterEntries.length,
    updated,
    inserted,
    deleted,
    errors,
  });
}
