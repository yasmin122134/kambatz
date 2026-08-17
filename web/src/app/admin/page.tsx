"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { PageShell } from "@/components/PageShell";
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
  const [exportJson, setExportJson] = useState("");
  const [approvedForExport, setApprovedForExport] = useState<Issue[]>([]);

  const loadIssues = useCallback(async () => {
    const q = filter === "all" ? "" : `?status=${filter}`;
    const res = await fetch(`/api/issues${q}`);
    if (res.ok) setIssues(await res.json());
  }, [filter]);

  const loadApproved = useCallback(async () => {
    const res = await fetch("/api/issues?status=approved");
    if (res.ok) setApprovedForExport(await res.json());
  }, []);

  const loadPeople = useCallback(async () => {
    const res = await fetch("/api/people");
    if (res.ok) setPeople(await res.json());
  }, []);

  useEffect(() => {
    fetch("/api/admin/me")
      .then((r) => r.json())
      .then((d) => setAuthed(!!d.admin))
      .catch(() => setAuthed(false));
  }, []);

  useEffect(() => {
    if (authed) {
      loadIssues();
      loadPeople();
      loadApproved();
    }
  }, [authed, loadIssues, loadPeople, loadApproved]);

  useEffect(() => {
    const trials = approvedForExport.map((i) => ({
      name: [ISSUE_TYPE_LABELS[i.issue_type], i.note].filter(Boolean).join(" | ") || i.person_name,
      start: i.start_time,
      end: i.end_time,
      who: [i.person_name],
    }));
    setExportJson(JSON.stringify(trials, null, 2));
  }, [approvedForExport]);

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
      loadApproved();
    }
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
    return (
      <PageShell title="כניסת מפקד" lede="הזינו את סיסמת הניהול.">
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
      lede="אשרו דיווחי צוערים, נהלו את רשימת המחזור, וייצאו חסימות מאושרות למחולל."
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
        <h3 className="font-display text-base mb-2">מחזור ({people.length})</h3>
        <form onSubmit={addPerson} className="bar mb-3">
          <input
            placeholder="שם חדש"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
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
      </section>

      <section className="card">
        <h3 className="font-display text-base mb-2">ייצוא למחולל (התנסויות)</h3>
        <p className="lede mb-3">
          העתיקו את ה-JSON למחולל — לשונית 06 → הוסיפו ידנית, או שמרו לשימוש עתידי.
          דיווחים <b>מאושרים</b> בלבד.
        </p>
        <textarea readOnly rows={8} className="mono text-xs" value={exportJson} />
      </section>
    </PageShell>
  );
}
