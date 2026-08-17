import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  PEOPLE_BASE_SELECT,
  PEOPLE_FLAG_SELECT,
  probePeopleEmail,
  probePeopleFlags,
} from "@/lib/people";

export async function GET() {
  const supabase = await createClient();
  const admin = await isAdmin();
  const withFlags = await probePeopleFlags(supabase);
  const withEmail = admin && (await probePeopleEmail(supabase));

  const base = withEmail
    ? PEOPLE_BASE_SELECT
    : "id,name,room,gender,active,created_at";
  const select = withFlags ? `${base},${PEOPLE_FLAG_SELECT}` : base;

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
