import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/auth";
import {
  createFairnessRequest,
  fairnessRulesChanged,
  getFairnessRules,
  listFairnessRequests,
  normalizeFairnessRules,
  resolveFairnessRequest,
} from "@/lib/fairness";
import { getSessionPerson } from "@/lib/session";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status") || "pending";
  const admin = await isAdmin();

  if (!admin) {
    return NextResponse.json({ error: "לא מורשה" }, { status: 401 });
  }

  try {
    const data = await listFairnessRequests(status);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const session = await getSessionPerson();
  if (!session) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  const body = await request.json();
  const note = String(body.note || "").trim();
  if (!note) {
    return NextResponse.json({ error: "יש לכתוב הסבר לשינוי המוצע" }, { status: 400 });
  }

  const current = await getFairnessRules();
  const proposed = normalizeFairnessRules(body.proposed_rules ?? body);

  const changed = fairnessRulesChanged(current, proposed);
  if (!changed) {
    return NextResponse.json({ error: "לא שיניתם אף ערך בטבלה" }, { status: 400 });
  }

  try {
    const data = await createFairnessRequest({
      personId: session.person.id,
      personName: session.person.name,
      proposedRules: proposed,
      note,
    });
    return NextResponse.json(data, { status: 201 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "שגיאה";
    if (msg.includes("fairness_rule_requests")) {
      return NextResponse.json(
        { error: "הריצו supabase/migration_fairness.sql" },
        { status: 500 },
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
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

  try {
    const updated = await resolveFairnessRequest(id, status);
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "שגיאה" },
      { status: 500 },
    );
  }
}
