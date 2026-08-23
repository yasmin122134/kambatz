"use client";

import { useCallback, useEffect, useState } from "react";

type SubscribeInfo = {
  feedUrl: string;
  googleSubscribeUrl: string;
  emailInvitesEnabled: boolean;
};

export function CalendarAutoSync() {
  const [info, setInfo] = useState<SubscribeInfo | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/me/calendar/subscribe")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setInfo)
      .catch(() => setError("לא ניתן לטעון קישור יומן"));
  }, []);

  const openGoogle = useCallback(() => {
    if (!info?.googleSubscribeUrl) return;
    window.open(info.googleSubscribeUrl, "_blank", "noopener,noreferrer");
  }, [info]);

  if (error) {
    return <p className="hint text-xs text-center">{error}</p>;
  }

  if (!info) {
    return <p className="hint text-xs text-center">טוען יומן…</p>;
  }

  return (
    <div className="space-y-2">
      {info.emailInvitesEnabled ? (
        <p className="hint text-xs text-center">
          כשמפרסמים לוח — תקבלו הזמנה אוטומטית למייל שלכם ב-Gmail.
        </p>
      ) : (
        <p className="hint text-xs text-center">
          לחצו פעם אחת — היומן יתעדכן לבד בכל פרסום (בלי להוריד קבצים).
        </p>
      )}

      <button type="button" className="btn-pri w-full" onClick={openGoogle}>
        חבר Google Calendar (פעם אחת)
      </button>

      <p className="hint text-xs text-center">
        Google Calendar → «הוסף לוח» → אישור. הלוח ייקרא «הגנם ועבס» ויתעדכן לבד.
      </p>
    </div>
  );
}
