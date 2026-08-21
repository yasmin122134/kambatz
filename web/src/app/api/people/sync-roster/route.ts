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
  const errors: string[] = [];

  for (const entry of roster as RosterEntry[]) {
    const email = entry.email.trim().toLowerCase();
    let row =
      byEmail.get(email) ||
      (entry.db_name ? byName.get(entry.db_name) : undefined) ||
      byName.get(entry.name);

    if (row) {
      const patch: Record<string, string | boolean> = { email };
      if (row.name !== entry.name) patch.name = entry.name;
      if (
        (DUTY_OFFICER_EMAILS as readonly string[]).includes(email)
      ) {
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

    const { data, error } = await supabase
      .from("people")
      .insert({ name: entry.name, email, active: true })
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

  return NextResponse.json({
    ok: errors.length === 0,
    total: (roster as RosterEntry[]).length,
    updated,
    inserted,
    errors,
  });
}
