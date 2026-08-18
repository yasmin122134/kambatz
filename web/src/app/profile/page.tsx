"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PageShell } from "@/components/PageShell";
import {
  ISSUE_STATUS_LABELS,
  PERSONAL_FLAG_LABELS,
  type Person,
  type PersonalFlags,
  type ProfileRequest,
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
      <PageShell title="הפרופיל שלי" lede="טוען…">
        <p className="hint">ממתין…</p>
      </PageShell>
    );
  }

  if (!person) {
    return (
      <PageShell title="הפרופיל שלי" lede="לא נמצא במאגר">
        <div className="card max-w-md space-y-3">
          {error && <p className="msg-err">{error}</p>}
          <button type="button" className="btn" onClick={signOut}>
            התנתקות
          </button>
          <Link href="/" className="text-sm text-ink2 hover:text-brick">
            ← חזרה לדף הבית
          </Link>
        </div>
      </PageShell>
    );
  }

  const approvedFlags = flagsFromPerson(person);
  const approvedList = activeFlagsList(approvedFlags);

  return (
    <PageShell
      title="הפרופיל שלי"
      lede="שינוי סימונים דורש אישור מפקד — לא נכנס לשיבוץ עד שיאושר."
    >
      <div className="card max-w-lg space-y-5">
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

        <div className="rounded-lg border border-line2 bg-bg/50 p-4 space-y-2">
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
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
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
          לדיווח חסימות שעות (מבחן, התנסות וכו׳) —{" "}
          <Link href="/report" className="text-brick hover:underline">
            טופס דיווח
          </Link>
        </p>
      </div>
    </PageShell>
  );
}
