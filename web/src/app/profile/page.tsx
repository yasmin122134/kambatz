"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import {
  ISSUE_STATUS_LABELS,
  PERSONAL_FLAG_LABELS,
  FAIRNESS_BUCKET_LABELS,
  MISSION_TYPE_LABELS,
  type Person,
  type PersonalFlags,
  type ProfileRequest,
  type PersonFairnessStats,
} from "@/lib/types";
import { createClient } from "@/lib/supabase/client";

const FLAG_KEYS = Object.keys(PERSONAL_FLAG_LABELS) as (keyof PersonalFlags)[];

type ProfileResponse = Person & { pending_request: ProfileRequest | null };

function flagsFromPerson(p: Person): PersonalFlags {
  return {
    km: p.km,
    exam: p.exam,
    no_weapon: p.no_weapon,
    no_guard: p.no_guard,
    no_mag: p.no_mag,
  };
}

function flagsFromRequest(r: ProfileRequest): PersonalFlags {
  return {
    km: r.km,
    exam: r.exam,
    no_weapon: r.no_weapon,
    no_guard: r.no_guard,
    no_mag: r.no_mag,
  };
}

function activeFlagsList(flags: PersonalFlags): string[] {
  return FLAG_KEYS.filter((k) => flags[k]).map((k) => PERSONAL_FLAG_LABELS[k]);
}

export default function ProfilePage() {
  const router = useRouter();
  const [person, setPerson] = useState<Person | null>(null);
  const [pendingRequest, setPendingRequest] = useState<ProfileRequest | null>(
    null,
  );
  const [flags, setFlags] = useState<PersonalFlags>({
    km: false,
    exam: false,
    no_weapon: false,
    no_guard: false,
    no_mag: false,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [fairness, setFairness] = useState<PersonFairnessStats | null>(null);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError("");
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      router.replace("/login?next=/profile");
      return;
    }

    const res = await fetch("/api/me");
    if (res.status === 401) {
      router.replace("/login?next=/profile");
      return;
    }
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(
        data.error ||
          "המייל שלכם לא נמצא במאגר המחזור. פנו למפקד לעדכון הדוק.",
      );
      setLoading(false);
      return;
    }

    const data = (await res.json()) as ProfileResponse;
    setPerson(data);
    setPendingRequest(data.pending_request ?? null);
    const approved = flagsFromPerson(data);
    setFlags(
      data.pending_request
        ? flagsFromRequest(data.pending_request)
        : approved,
    );

    fetch("/api/me/fairness")
      .then((r) => (r.ok ? r.json() : null))
      .then(setFairness)
      .catch(() => setFairness(null));

    setLoading(false);
  }, [router]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");

    const res = await fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(flags),
    });
    const data = await res.json().catch(() => ({}));
    setSaving(false);

    if (!res.ok) {
      setError(data.error || "שגיאה בשליחה");
      return;
    }

    if (data.pending_request) {
      setPendingRequest(data.pending_request);
    }
    setMessage(data.message || "הבקשה נשלחה — ממתינה לאישור מפקד");
  }

  async function signOut() {
    await fetch("/api/auth/signout", { method: "POST" });
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
  }

  if (loading) {
    return (
      <AppShell title="פרופיל">
        <main className="mx-auto max-w-lg px-5 py-8">
          <p className="hint">טוען…</p>
        </main>
      </AppShell>
    );
  }

  if (!person) {
    return (
      <AppShell title="פרופיל">
        <main className="mx-auto max-w-lg px-5 py-8">
          <div className="card space-y-3">
            {error && <p className="msg-err">{error}</p>}
            <button type="button" className="btn" onClick={signOut}>
              התנתקות
            </button>
            <Link href="/" className="text-sm text-ink2 hover:text-brick">
              ← חזרה לדף הבית
            </Link>
          </div>
        </main>
      </AppShell>
    );
  }

  const approvedFlags = flagsFromPerson(person);
  const approvedList = activeFlagsList(approvedFlags);

  return (
    <AppShell title="פרופיל">
      <main className="mx-auto max-w-lg px-5 py-8">
        <div className="card mb-4">
          <h2 className="font-display text-xl">הפרופיל שלי</h2>
          <p className="lede">שינוי סימונים דורש אישור מפקד.</p>
        </div>
      <div className="card space-y-5">
        <div>
          <p className="text-sm text-ink2">שם</p>
          <p className="font-display text-xl">{person.name}</p>
          {person.email && (
            <p className="mono text-sm text-ink3 mt-1">{person.email}</p>
          )}
          {person.room && (
            <p className="hint mt-1">חדר: {person.room}</p>
          )}
        </div>

        {fairness && (
          <div className="rounded-2xl border border-line2 bg-bone2/50 p-4 space-y-3">
            <div className="bar spread flex-wrap gap-2">
              <p className="font-display text-sm">נקודות שמירה (טבלת צדק)</p>
              <Link href="/fairness" className="text-xs text-brick hover:underline">
                טבלת צדק
              </Link>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-sm">
              <div>
                <p className="hint text-xs">תקופה נוכחית</p>
                <p className="font-display text-lg">{fairness.periodPoints}</p>
              </div>
              <div>
                <p className="hint text-xs">ניקוד קודם</p>
                <p className="font-display text-lg">{fairness.priorScore}</p>
              </div>
              <div>
                <p className="hint text-xs">סה״כ</p>
                <p className="font-display text-lg text-olive">{fairness.totalPoints}</p>
              </div>
            </div>
            {fairness.history.length > 0 ? (
              <ul className="text-sm space-y-2 max-h-48 overflow-y-auto">
                {fairness.history.map((h) => (
                  <li
                    key={h.id}
                    className="flex flex-wrap gap-x-2 gap-y-1 border-b border-line2 pb-1.5"
                  >
                    <span className="mono text-xs">{h.missionDate}</span>
                    <span className="mono text-xs">{h.timeLabel}</span>
                    <span>{h.positionName}</span>
                    <span className="text-ink2 text-xs">
                      {MISSION_TYPE_LABELS[h.missionType]} ·{" "}
                      {FAIRNESS_BUCKET_LABELS[h.bucket].replace(" (לשעה)", "")}
                    </span>
                    <span className="mr-auto font-semibold text-olive">
                      +{h.points}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint text-sm">אין משימות מפורסמות עדיין.</p>
            )}
          </div>
        )}

        <div className="rounded-2xl border border-line2 bg-bone2/50 p-4 space-y-2">
          <p className="font-display text-sm">סימונים מאושרים (בשיבוץ)</p>
          {approvedList.length === 0 ? (
            <p className="hint text-sm">אין סימונים פעילים</p>
          ) : (
            <ul className="text-sm space-y-1">
              {approvedList.map((label) => (
                <li key={label}>✓ {label}</li>
              ))}
            </ul>
          )}
        </div>

        {pendingRequest && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-2xl px-3 py-2">
            יש בקשה ממתינה — {ISSUE_STATUS_LABELS.pending}. שינוי ושליחה
            מחדש יעדכן את הבקשה.
          </p>
        )}

        <form onSubmit={save} className="space-y-4">
          <div className="space-y-3">
            <p className="font-display text-base">בקשה לעדכון סימונים</p>
            {FLAG_KEYS.map((key) => (
              <label
                key={key}
                className="flex flex-row-reverse items-center justify-end gap-3 cursor-pointer w-fit max-w-full"
              >
                <input
                  type="checkbox"
                  className="shrink-0 size-4"
                  checked={flags[key]}
                  onChange={(e) =>
                    setFlags((f) => ({ ...f, [key]: e.target.checked }))
                  }
                />
                <span className="text-right">{PERSONAL_FLAG_LABELS[key]}</span>
              </label>
            ))}
          </div>

          {error && <p className="msg-err">{error}</p>}
          {message && <p className="msg-ok">{message}</p>}

          <div className="bar">
            <button type="submit" className="btn-pri" disabled={saving}>
              {saving
                ? "שולח…"
                : pendingRequest
                  ? "עדכן בקשה לאישור"
                  : "שלח לאישור מפקד"}
            </button>
            <button type="button" className="btn" onClick={signOut}>
              התנתקות
            </button>
          </div>
        </form>

        <p className="hint">
          לדיווח חסימות שעות —{" "}
          <Link href="/report" className="text-brick hover:underline">
            הוספת אילוץ
          </Link>
        </p>
      </div>
      </main>
    </AppShell>
  );
}
