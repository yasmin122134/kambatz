import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  getSessionPerson,
  pickPersonalFlags,
} from "@/lib/session";

export async function GET() {
  const session = await getSessionPerson();
  if (!session) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }
  return NextResponse.json(session.person);
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
  const { data, error } = await supabase
    .from("people")
    .update({
      ...flags,
      auth_user_id: session.user.id,
    })
    .eq("id", session.person.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
