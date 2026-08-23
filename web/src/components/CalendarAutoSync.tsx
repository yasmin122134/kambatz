"use client";

import { useCallback, useEffect, useState } from "react";

type PreviewEvent = {
  uid: string;
  summary: string;
  description?: string;
  googleUrl: string;
};

type Preview = {
  count: number;
  email: string | null;
  emailInvitesEnabled: boolean;
  events: PreviewEvent[];
};

export function CalendarAutoSync() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState("");
  const [emailStatus, setEmailStatus] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    fetch("/api/me/calendar/preview")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setPreview)
      .catch(() => setError("לא ניתן לטעון משמרות ליומן"));
  }, []);

  const sendEmailInvites = useCallback(async () => {
    setSending(true);
    setEmailStatus("");
    try {
      const res = await fetch("/api/me/calendar/email", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEmailStatus(data.error || "שליחה נכשלה");
        return;
      }
      setEmailStatus(data.message || "נשלח");
    } catch {
      setEmailStatus("שגיאת רשת");
    } finally {
      setSending(false);
    }
  }, []);

  if (error) {
    return <p className="hint text-xs text-center">{error}</p>;
  }

  if (!preview) {
    return <p className="hint text-xs text-center">טוען יומן…</p>;
  }

  if (preview.count === 0) {
    return (
      <p className="hint text-xs text-center">
        אין משמרות בלוח שפורסם. כשייפורסם לוח ותהיי משובצת — יופיעו כאן כפתורי
        «הוסף ליומן».
      </p>
    );
  }

  return (
    <div className="space-y-3 border-t border-bone2 pt-4">
      <p className="font-display text-base text-center">יומן — הגנם ועבס</p>
      <p className="hint text-xs text-center">
        {preview.count} משמרות · לחצו «הוסף» — Google Calendar יפתח עם האירוע
        המוכן
      </p>

      <ul className="space-y-2 max-h-48 overflow-y-auto">
        {preview.events.map((event) => (
          <li
            key={event.uid}
            className="flex items-center justify-between gap-2 text-sm"
          >
            <span className="truncate">{event.summary}</span>
            <a
              href={event.googleUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-sm shrink-0"
            >
              הוסף
            </a>
          </li>
        ))}
      </ul>

      {preview.emailInvitesEnabled && preview.email && (
        <div className="space-y-1">
          <button
            type="button"
            className="btn w-full"
            disabled={sending}
            onClick={sendEmailInvites}
          >
            {sending ? "שולח…" : `שלח ${preview.count} הזמנות ל-${preview.email}`}
          </button>
          <p className="hint text-xs text-center">
            הכי אמין — הזמנות ישירות ל-Gmail (בלי מנוי ללוח)
          </p>
        </div>
      )}

      {emailStatus && (
        <p className="text-xs text-center text-ink2">{emailStatus}</p>
      )}
    </div>
  );
}
