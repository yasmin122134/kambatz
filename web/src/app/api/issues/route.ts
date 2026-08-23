import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/auth";
import { parseIssuePayload } from "@/lib/issue-validation";
import { getSessionPerson } from "@/lib/session";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const mine = searchParams.get("person_name");
  const admin = await isAdmin();
  const session = await getSessionPerson();

  if (!admin && !session) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  if (!admin) {
    if (mine && mine !== session!.person.name) {
      return NextResponse.json({ error: "לא מורשה" }, { status: 403 });
    }
  }

  const supabase = await createClient();
  let query = supabase.from("issues").select("*").order("created_at", { ascending: false });

  if (status) query = query.eq("status", status);
  if (admin && mine) {
    query = query.eq("person_name", mine);
  } else if (!admin) {
    query = query.eq("person_name", session!.person.name);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const body = await request.json();
  const admin = await isAdmin();
  const session = await getSessionPerson();
  const person_name = String(body.person_name || "").trim();
  const autoApprove = admin && !!body.approved;

  if (!admin && !session) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  if (!admin && person_name !== session!.person.name) {
    return NextResponse.json(
      { error: "ניתן לדווח אילוצים רק עבור עצמך" },
      { status: 403 },
    );
  }

  if (!person_name) {
    return NextResponse.json({ error: "חסרים שדות חובה" }, { status: 400 });
  }

  const parsed = parseIssuePayload(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const { constraint_date, start_time, end_time, issue_type, note } = parsed;

  if (body.approved && !admin) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
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
      constraint_date,
      start_time,
      end_time,
      issue_type,
      note,
      status: autoApprove ? "approved" : "pending",
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
