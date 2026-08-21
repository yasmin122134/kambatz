import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  PEOPLE_BASE_SELECT,
  PEOPLE_FLAG_SELECT,
  probePeopleEmail,
  probePeopleFlags,
  probePeopleAdmin,
  probePeopleOfficer,
} from "@/lib/people";
import { pickPersonalFlags } from "@/lib/session";

export async function GET() {
  const supabase = await createClient();
  const admin = await isAdmin();
  const withFlags = await probePeopleFlags(supabase);
  const withEmail = admin && (await probePeopleEmail(supabase));
  const withAdmin = admin && (await probePeopleAdmin(supabase));
  const withOfficer = admin && (await probePeopleOfficer(supabase));

  const base = withEmail
    ? PEOPLE_BASE_SELECT
    : "id,name,room,gender,active,created_at";
  let select = withFlags ? `${base},${PEOPLE_FLAG_SELECT}` : base;
  if (withAdmin) select += ",is_admin";
  if (withOfficer) select += ",is_officer";

  const { data, error } = await supabase
    .from("people")
    .select(select)
    .eq("active", true)
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const body = await request.json();
  const name = String(body.name || "").trim();
  if (!name) {
    return NextResponse.json({ error: "שם חובה" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("people")
    .insert({ name, room: body.room || null, gender: body.gender || null })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const body = await request.json();
  const id = String(body.id || "").trim();
  if (!id) {
    return NextResponse.json({ error: "חסר מזהה צוער" }, { status: 400 });
  }

  const flags = pickPersonalFlags(body);
  if (flags.no_weapon && flags.no_guard) {
    return NextResponse.json(
      { error: "לא ניתן לסמן גם ללא נשק וגם פטור שמירה" },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const withFlags = await probePeopleFlags(supabase);
  if (!withFlags) {
    return NextResponse.json(
      {
        error:
          "עמודות הסימונים חסרות — הריצו supabase/migration_scheduler.sql",
      },
      { status: 500 },
    );
  }

  const withOfficer = await probePeopleOfficer(supabase);
  const patch: Record<string, unknown> = { ...flags };
  if (withOfficer && typeof body.is_officer === "boolean") {
    patch.is_officer = body.is_officer;
    patch.is_admin = body.is_officer;
  }

  const { data, error } = await supabase
    .from("people")
    .update(patch)
    .eq("id", id)
    .select(
      `${PEOPLE_BASE_SELECT},${PEOPLE_FLAG_SELECT}${withOfficer ? ",is_officer,is_admin" : ""}`,
    )
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase
    .from("profile_requests")
    .update({ status: "rejected" })
    .eq("person_id", id)
    .eq("status", "pending");

  return NextResponse.json(data);
}
