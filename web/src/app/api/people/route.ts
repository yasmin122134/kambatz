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
import { buildPeopleAdminPatch } from "@/lib/session";

export async function GET(request: Request) {
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

  const includeInactive =
    admin &&
    new URL(request.url).searchParams.get("include_inactive") === "1";

  let query = supabase.from("people").select(select).order("name");
  if (!includeInactive) {
    query = query.eq("active", true);
  }

  const { data, error } = await query;

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
  const { data: existing } = await supabase
    .from("people")
    .select("id,active")
    .eq("name", name)
    .maybeSingle();

  if (existing) {
    if (existing.active !== false) {
      return NextResponse.json({ error: "השם כבר במחזור" }, { status: 409 });
    }
    const reactivate: Record<string, unknown> = { active: true };
    if (body.room) reactivate.room = body.room;
    if (body.gender) reactivate.gender = body.gender;
    const { data, error } = await supabase
      .from("people")
      .update(reactivate)
      .eq("id", existing.id)
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(data);
  }

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

  const supabase = await createClient();
  const withFlags = await probePeopleFlags(supabase);
  const withOfficer = await probePeopleOfficer(supabase);
  const result = buildPeopleAdminPatch(body, { withFlags, withOfficer });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  const selectCols = withFlags
    ? `${PEOPLE_BASE_SELECT},${PEOPLE_FLAG_SELECT}${withOfficer ? ",is_officer,is_admin" : ""}`
    : `${PEOPLE_BASE_SELECT}${withOfficer ? ",is_officer,is_admin" : ""}`;

  const { data, error } = await supabase
    .from("people")
    .update(result.patch)
    .eq("id", id)
    .select(selectCols)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (result.flagsChanged || result.patch.active === false) {
    await supabase
      .from("profile_requests")
      .update({ status: "rejected" })
      .eq("person_id", id)
      .eq("status", "pending");
  }

  return NextResponse.json(data);
}
