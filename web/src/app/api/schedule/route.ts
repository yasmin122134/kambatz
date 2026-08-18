import { NextResponse } from "next/server";
import { getScheduleView } from "@/lib/schedule";
import { getSessionPerson } from "@/lib/session";

export async function GET() {
  const session = await getSessionPerson();
  if (!session) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  const view = await getScheduleView(session.person.name);
  return NextResponse.json({
    personName: session.person.name,
    ...view,
  });
}
