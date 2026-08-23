import { NextResponse } from "next/server";
import { sendAllCalendarInvitesForPerson } from "@/lib/calendar-invites";
import { getSessionPerson } from "@/lib/session";

export async function POST() {
  const session = await getSessionPerson();
  if (!session) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  const result = await sendAllCalendarInvitesForPerson(session.person);

  if (result.error === "email_not_configured") {
    return NextResponse.json(
      { error: "שליחת מייל לא מוגדרת בשרת — השתמשו ב«הוסף» לכל משמרת" },
      { status: 503 },
    );
  }
  if (result.error === "no_email") {
    return NextResponse.json(
      { error: "אין מייל בפרופיל — פנו למנהל לסנכרן מיילים" },
      { status: 400 },
    );
  }
  if (result.total === 0) {
    return NextResponse.json(
      { error: "אין משמרות בלוח שפורסם — אין מה לשלוח" },
      { status: 404 },
    );
  }

  return NextResponse.json({
    sent: result.sent,
    total: result.total,
    message:
      result.sent > 0
        ? `נשלחו ${result.sent} הזמנות ל-${session.person.email}`
        : "לא נשלח — בדקו את תיבת הספאם",
  });
}
