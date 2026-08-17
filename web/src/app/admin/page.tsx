"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { PageShell } from "@/components/PageShell";
import { NameCombobox } from "@/components/NameCombobox";
import {
  ISSUE_TYPE_LABELS,
  ISSUE_STATUS_LABELS,
  type Issue,
  type Person,
} from "@/lib/types";

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [loginErr, setLoginErr] = useState("");
  const [issues, setIssues] = useState<Issue[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [newName, setNewName] = useState("");
  const [bulkNames, setBulkNames] = useState("");
  const [filter, setFilter] = useState<"pending" | "approved" | "all">("pending");
  const [syncMsg, setSyncMsg] = useState("");
  const [syncing, setSyncing] = useState(false);

  const loadIssues = useCallback(async () => {
    const q = filter === "all" ? "" : `?status=${filter}`;
    const res = await fetch(`/api/issues${q}`);
    if (res.ok) setIssues(await res.json());
  }, [filter]);

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
      loadIssues();
      loadPeople();
    }
  }, [authed, loadIssues, loadPeople]);

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
    setAuthed(false);
  }

  async function setStatus(id: string, status: "approved" | "rejected") {
    const res = await fetch("/api/issues", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    if (res.ok) {
      loadIssues();
    }
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
      <PageShell title="ניהול" lede="טוען…">
        <p className="hint">ממתין…</p>
      </PageShell>
    );
  }

  if (!authed) {
    const needsScheduler =
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).get("next") === "/scheduler.html";

    return (
      <PageShell
        title="כניסת מפקד"
        lede={
          needsScheduler
            ? "יש להתחבר כדי לפתוח את המחולל."
            : "הזינו את סיסמת הניהול."
        }
      >
        <form onSubmit={login} className="card max-w-sm space-y-4">
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
            כניסה
          </button>
        </form>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="לוח בקרה"
      lede="אשרו דיווחי צוערים ונהלו את רשימת המחזור. חסימות מאושרות נכנסות אוטומטית למחולל."
    >
      <div className="bar mb-6">
        <a href="/scheduler.html" className="btn-pri">
          פתח מחולל שיבוץ מלא
        </a>
        <button type="button" className="btn" onClick={logout}>
          יציאה
        </button>
      </div>

      <section className="card mb-6">
        <h3 className="font-display text-base mb-2">סנכרון דוק פלוגה</h3>
        <p className="lede mb-3">
          מייבא 53 צוערים מהדוק — שמות, מיילים, ותיקון שמות ישנים. דורש הרצת{" "}
          <code className="mono text-xs">migration_email_auth.sql</code> ב-Supabase.
        </p>
        <button
          type="button"
          className="btn-pri btn-sm"
          disabled={syncing}
          onClick={syncRoster}
        >
          {syncing ? "מסנכרן…" : "סנכרן מיילים מהדוק"}
        </button>
        {syncMsg && <p className="hint mt-2">{syncMsg}</p>}
      </section>

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
          {people.map((p) => p.name).join(" · ") || "אין שמות"}
        </p>
      </section>

      <section className="card mb-6">
        <div className="bar spread mb-4">
          <h3 className="font-display text-base">דיווחים</h3>
          <div className="flex gap-2">
            {(["pending", "approved", "all"] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`btn-sm ${filter === f ? "on" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f === "pending" ? "ממתינים" : f === "approved" ? "מאושרים" : "הכל"}
              </button>
            ))}
          </div>
        </div>

        {issues.length === 0 ? (
          <p className="hint">אין דיווחים{filter !== "all" ? " בסינון הזה" : ""}.</p>
        ) : (
          <ul className="space-y-3">
            {issues.map((iss) => (
              <li key={iss.id} className="issue-row">
                <div>
                  <b>{iss.person_name}</b>
                  <span className="mono mx-2">
                    {iss.start_time}–{iss.end_time}
                  </span>
                  <span>{ISSUE_TYPE_LABELS[iss.issue_type]}</span>
                  {iss.note && (
                    <span className="text-ink2 mr-2"> — {iss.note}</span>
                  )}
                  <span className={`tag tag-${iss.status} mr-2`}>
                    {ISSUE_STATUS_LABELS[iss.status]}
                  </span>
                </div>
                {iss.status === "pending" && (
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      className="btn-pri btn-sm"
                      onClick={() => setStatus(iss.id, "approved")}
                    >
                      אשר
                    </button>
                    <button
                      type="button"
                      className="btn-sm"
                      onClick={() => setStatus(iss.id, "rejected")}
                    >
                      דחה
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="hint mt-4">
          דיווחים מאושרים מופיעים אוטומטית במחולל — לשונית 06 · חסימות.
        </p>
      </section>
    </PageShell>
  );
}
