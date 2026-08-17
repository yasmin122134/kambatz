import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const mine = searchParams.get("person_name");
  const admin = await isAdmin();

  if (!admin && !mine) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const supabase = await createClient();
  let query = supabase.from("issues").select("*").order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (mine) query = query.eq("person_name", mine);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const body = await request.json();
  const person_name = String(body.person_name || "").trim();
  const start_time = String(body.start_time || "").trim();
  const end_time = String(body.end_time || "").trim();
  const issue_type = body.issue_type;
  const note = body.note ? String(body.note).trim() : null;

  if (!person_name || !start_time || !end_time || !issue_type) {
    return NextResponse.json({ error: "חסרים שדות חובה" }, { status: 400 });
  }

  if (!/^\d{1,2}:\d{2}$/.test(start_time) || !/^\d{1,2}:\d{2}$/.test(end_time)) {
    return NextResponse.json({ error: "פורמט שעה לא תקין (HH:MM)" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: person } = await supabase
    .from("people")
    .select("id")
    .eq("name", person_name)
    .eq("active", true)
    .maybeSingle();

  if (!person) {
    return NextResponse.json({ error: "השם לא ברשימת המחזור" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("issues")
    .insert({
      person_id: person.id,
      person_name,
      start_time,
      end_time,
      issue_type,
      note,
      status: "pending",
    })
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
  const { id, status } = body;
  if (!id || !["approved", "rejected", "pending"].includes(status)) {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issues")
    .update({ status })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
