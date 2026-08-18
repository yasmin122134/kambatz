import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { pickPersonalFlags } from "@/lib/session";

export async function GET(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const supabase = await createClient();
  let query = supabase
    .from("profile_requests")
    .select("*")
    .order("created_at", { ascending: false });

  if (status && status !== "all") {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    if (error.code === "PGRST205" || error.message.includes("profile_requests")) {
      return NextResponse.json([]);
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

export async function PATCH(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  const body = await request.json();
  const { id, status } = body;
  if (!id || !["approved", "rejected"].includes(status)) {
    return NextResponse.json({ error: "בקשה לא תקינה" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: req, error: fetchErr } = await supabase
    .from("profile_requests")
    .select("*")
    .eq("id", id)
    .single();

  if (fetchErr || !req) {
    return NextResponse.json({ error: "בקשה לא נמצאה" }, { status: 404 });
  }

  const { data: updated, error: updateErr } = await supabase
    .from("profile_requests")
    .update({ status })
    .eq("id", id)
    .select()
    .single();

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  if (status === "approved" && req.person_id) {
    const flags = pickPersonalFlags(req);
    const { error: personErr } = await supabase
      .from("people")
      .update(flags)
      .eq("id", req.person_id);

    if (personErr) {
      return NextResponse.json({ error: personErr.message }, { status: 500 });
    }
  }

  return NextResponse.json(updated);
}
