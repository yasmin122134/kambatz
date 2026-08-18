import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getSessionPerson,
  pickPersonalFlags,
} from "@/lib/session";
import type { ProfileRequest } from "@/lib/types";

async function fetchPendingRequest(
  supabase: Awaited<ReturnType<typeof createClient>>,
  personId: string,
): Promise<ProfileRequest | null> {
  const { data, error } = await supabase
    .from("profile_requests")
    .select("*")
    .eq("person_id", personId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (error.code === "PGRST205" || error.message.includes("profile_requests")) {
      return null;
    }
    return null;
  }
  return data as ProfileRequest | null;
}

export async function GET() {
  const session = await getSessionPerson();
  if (!session) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  const supabase = await createClient();
  const pending_request = await fetchPendingRequest(
    supabase,
    session.person.id,
  );

  return NextResponse.json({
    ...session.person,
    pending_request,
  });
}

export async function PATCH(request: Request) {
  const session = await getSessionPerson();
  if (!session) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  const body = await request.json();
  const flags = pickPersonalFlags(body);

  if (flags.no_weapon && flags.no_guard) {
    return NextResponse.json(
      { error: "לא ניתן לסמן גם ללא נשק וגם פטור שמירה" },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  const existing = await fetchPendingRequest(supabase, session.person.id);
  if (existing) {
    const { data, error } = await supabase
      .from("profile_requests")
      .update(flags)
      .eq("id", existing.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      pending_request: data,
      message: "הבקשה עודכנה — ממתינה לאישור מפקד",
    });
  }

  const { data, error } = await supabase
    .from("profile_requests")
    .insert({
      person_id: session.person.id,
      person_name: session.person.name,
      ...flags,
      status: "pending",
    })
    .select()
    .single();

  if (error) {
    if (error.code === "PGRST205" || error.message.includes("profile_requests")) {
      return NextResponse.json(
        {
          error:
            "טבלת profile_requests חסרה — הריצו supabase/migration_profile_requests.sql",
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await supabase
    .from("people")
    .update({ auth_user_id: session.user.id })
    .eq("id", session.person.id);

  return NextResponse.json({
    ok: true,
    pending_request: data,
    message: "הבקשה נשלחה — ממתינה לאישור מפקד",
  });
}
