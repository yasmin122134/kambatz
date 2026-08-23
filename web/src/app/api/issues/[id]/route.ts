import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import { parseIssuePayload } from "@/lib/issue-validation";
import { getSessionPerson } from "@/lib/session";
import { createClient } from "@/lib/supabase/server";
import type { IssueStatus } from "@/lib/types";

type Params = { params: Promise<{ id: string }> };

async function loadIssue(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("issues").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

function canManageIssue(
  issue: { person_name: string },
  session: Awaited<ReturnType<typeof getSessionPerson>>,
  admin: boolean,
): boolean {
  if (admin) return true;
  return !!session && issue.person_name === session.person.name;
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const admin = await isAdmin();
  const session = await getSessionPerson();

  if (!admin && !session) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  let issue;
  try {
    issue = await loadIssue(id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }

  if (!issue) {
    return NextResponse.json({ error: "לא נמצא" }, { status: 404 });
  }

  if (!canManageIssue(issue, session, admin)) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 403 });
  }

  const body = await request.json();
  const statusOnly =
    body.status &&
    !body.constraint_date &&
    !body.start_time &&
    !body.end_time &&
    !body.issue_type &&
    body.note === undefined;

  if (statusOnly) {
    if (!admin) {
      return NextResponse.json({ error: "לא מורשה" }, { status: 403 });
    }
    const status = body.status as IssueStatus;
    if (!["approved", "rejected", "pending"].includes(status)) {
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

  const parsed = parseIssuePayload(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const nextStatus: IssueStatus = admin
    ? (["approved", "rejected", "pending"].includes(body.status)
        ? body.status
        : issue.status)
    : issue.status === "approved"
      ? "pending"
      : issue.status;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("issues")
    .update({
      ...parsed,
      status: nextStatus,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const admin = await isAdmin();
  const session = await getSessionPerson();

  if (!admin && !session) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  let issue;
  try {
    issue = await loadIssue(id);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }

  if (!issue) {
    return NextResponse.json({ error: "לא נמצא" }, { status: 404 });
  }

  if (!canManageIssue(issue, session, admin)) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 403 });
  }

  const supabase = await createClient();
  const { error } = await supabase.from("issues").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
