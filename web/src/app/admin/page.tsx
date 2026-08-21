"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import { NameCombobox } from "@/components/NameCombobox";
import { AdminManualConstraints } from "@/components/AdminManualConstraints";
import { createClient } from "@/lib/supabase/client";
import {
  type Person,
} from "@/lib/types";

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [newName, setNewName] = useState("");
  const [bulkNames, setBulkNames] = useState("");
  const [syncMsg, setSyncMsg] = useState("");
  const [syncing, setSyncing] = useState(false);

  const loadPeople = useCallback(async () => {
    const res = await fetch("/api/people");
    if (res.ok) setPeople(await res.json());
  }, []);

  useEffect(() => {
    fetch("/api/admin/me")
      .then((r) => r.json())
      .then((d) => {
        const ok = !!d.admin;
        setAuthed(ok);
        if (ok) redirectAfterLogin();
      })
      .catch(() => setAuthed(false));
  }, []);

  function redirectAfterLogin() {
    const next = new URLSearchParams(window.location.search).get("next");
    if (next?.startsWith("/") && !next.startsWith("//")) {
      window.location.href = next;
    }
  }

  useEffect(() => {
    if (authed) {
      loadPeople();
    }
  }, [authed, loadPeople]);

  async function login(e: FormEvent) {
    e.preventDefault();
    setLoginErr("");
    const res = await fetch("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (!res.ok) {
      setLoginErr("סיסמה שגויה");
      return;
    }
    const next = new URLSearchParams(window.location.search).get("next");
    if (next?.startsWith("/") && !next.startsWith("//")) {
      window.location.href = next;
      return;
    }
    setAuthed(true);
    setPassword("");
  }

  async function logout() {
    await fetch("/api/admin/login", { method: "DELETE" });
    await fetch("/api/auth/signout", { method: "POST" });
    const supabase = createClient();
    await supabase.auth.signOut();
    setAuthed(false);
  }

  async function loginWithGoogle() {
    setLoginErr("");
    const supabase = createClient();
    const next =
      new URLSearchParams(window.location.search).get("next") || "/admin";
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setLoginErr(
        error.message.includes("not enabled")
          ? "Google לא מופעל ב-Supabase — ראו הוראות בדף /login"
          : error.message,
      );
      return;
    }
    if (data?.url) window.location.href = data.url;
  }

  async function syncRoster() {
    setSyncing(true);
    setSyncMsg("");
    const res = await fetch("/api/people/sync-roster", { method: "POST" });
    const data = await res.json();
    setSyncing(false);
    if (!res.ok) {
      setSyncMsg(data.error || "שגיאה בסנכרון");
      return;
    }
    setSyncMsg(
      `סונכרנו ${data.total} צוערים (${data.updated} עודכנו, ${data.inserted} חדשים)` +
        (data.errors?.length ? ` · ${data.errors.length} שגיאות` : ""),
    );
    loadPeople();
  }

  async function syncSquads() {
    setSyncing(true);
    setSyncMsg("");
    const res = await fetch("/api/people/sync-squads", { method: "POST" });
    const data = await res.json();
    setSyncing(false);
    if (!res.ok) {
      setSyncMsg(data.error || "שגיאה בסנכרון צוותים");
      return;
    }
    const counts = data.squadCounts
      ? Object.entries(data.squadCounts)
          .map(([k, v]) => `צ${k}:${v}`)
          .join(", ")
      : "";
    setSyncMsg(
      `עודכנו ${data.updated} צוערים${counts ? ` (${counts})` : ""}` +
        (data.errors?.length ? ` · ${data.errors.length} שגיאות` : ""),
    );
    loadPeople();
  }

  async function addPerson(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    await fetch("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setNewName("");
    loadPeople();
  }

  async function addBulk(e: FormEvent) {
    e.preventDefault();
    const names = bulkNames.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    for (const name of names) {
      await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
    }
    setBulkNames("");
    loadPeople();
  }

  if (authed === null) {
    return (
      <AppShell title="ניהול">
        <main className="mx-auto max-w-sm px-5 py-8">
          <p className="hint">טוען…</p>
        </main>
      </AppShell>
    );
  }

  if (!authed) {
    return (
      <AppShell title="כניסת מפקד">
        <main className="mx-auto max-w-sm px-5 py-8">
          <div className="card mb-4">
            <h2 className="font-display text-xl">כניסת מפקד</h2>
            <p className="lede">הזינו סיסמה או התחברו עם Google.</p>
          </div>
        <form onSubmit={login} className="card space-y-4">
          <div className="field">
            <label htmlFor="pw">סיסמה</label>
            <input
              id="pw"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {loginErr && <p className="msg-err">{loginErr}</p>}
          <button type="submit" className="btn-pri">
            כניסה בסיסמה
          </button>
          <div className="relative text-center text-sm text-ink3">
            <span className="bg-card px-2 relative z-10">או</span>
            <span className="absolute inset-x-0 top-1/2 border-t border-line2" />
          </div>
          <button
            type="button"
            className="btn w-full"
            onClick={loginWithGoogle}
          >
            התחברות עם Google (מפקד)
          </button>
          <p className="hint text-xs">
            מפקדים מורשים (למשל יסמין חדד) יכולים להיכנס עם המייל מהדוק.
          </p>
        </form>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell title="דף מנהל">
      <main className="mx-auto max-w-3xl px-5 py-8">
        <div className="card mb-6">
          <h2 className="font-display text-xl mb-2">ניהול</h2>
          <p className="lede mb-4">
            יצירת ימי משימה, שיבוץ, ואישור אילוצים — רוב הפעולות מהרשימה המלאה.
          </p>
          <div className="bar flex-wrap gap-2">
            <Link href="/admin/missions" className="btn-pri">
              ימי משימה
            </Link>
            <Link href="/board" className="btn">
              רשימה מלאה + אילוצים
            </Link>
            <button type="button" className="btn-sm" onClick={logout}>
              יציאה
            </button>
          </div>
        </div>

      <section className="card mb-6">
        <h3 className="font-display text-base mb-2">סנכרון דוק פלוגה</h3>
        <p className="lede mb-3">
          מייבא 53 צוערים מהדוק — שמות, מיילים, ותיקון שמות ישנים. דורש הרצת{" "}
          <code className="mono text-xs">migration_email_auth.sql</code> ב-Supabase.
        </p>
        <div className="bar flex-wrap gap-2">
          <button
            type="button"
            className="btn-pri btn-sm"
            disabled={syncing}
            onClick={syncRoster}
          >
            {syncing ? "מסנכרן…" : "סנכרן מיילים מהדוק"}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            disabled={syncing}
            onClick={syncSquads}
          >
            {syncing ? "מסנכרן…" : "סנכרן צוותים (13–16)"}
          </button>
        </div>
        <p className="hint text-xs mt-2">
          צוותים מקובץ הדוק (צוות 13–16). דורש{" "}
          <code className="mono">migration_squad.sql</code>.
        </p>
        {syncMsg && <p className="hint mt-2">{syncMsg}</p>}
      </section>

      <AdminManualConstraints
        people={people}
        onSaved={() => {
          loadPeople();
        }}
      />

      <section className="card mb-6">
        <h3 className="font-display text-base mb-2">מחזור ({people.length})</h3>
        <form onSubmit={addPerson} className="bar mb-3">
          <NameCombobox
            value={newName}
            onChange={setNewName}
            placeholder="הקלידו שם חדש או קיים"
            className="flex-1"
          />
          <button type="submit" className="btn-pri btn-sm">
            הוסף
          </button>
        </form>
        <form onSubmit={addBulk} className="space-y-2">
          <textarea
            placeholder="הדביקו רשימת שמות — שורה לכל שם"
            rows={4}
            value={bulkNames}
            onChange={(e) => setBulkNames(e.target.value)}
          />
          <button type="submit" className="btn-sm">
            הוסף הכל
          </button>
        </form>
        <p className="hint mt-3">
          {people
            .map((p) =>
              p.is_officer || p.is_admin
                ? `${p.name} (קצין תורן / מנהל)`
                : p.name,
            )
            .join(" · ") || "אין שמות"}
        </p>
        <p className="hint text-xs mt-2">
          קצינים תורנים: רני פלג, יסמין חדד — הרצו{" "}
          <code className="mono">migration_officer.sql</code> ב-Supabase לסימון ב-DB.
        </p>
      </section>
      </main>
    </AppShell>
  );
}
