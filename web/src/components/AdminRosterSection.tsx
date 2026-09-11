"use client";

import { FormEvent, useMemo, useState } from "react";
import { NameCombobox } from "@/components/NameCombobox";
import { SQUAD_LABELS } from "@/lib/squad-utils";
import type { Person } from "@/lib/types";

type Filter = "active" | "removed";

type Props = {
  people: Person[];
  onChanged: () => void;
};

function squadLabel(squad: number | null | undefined): string {
  if (squad == null || squad < 1 || squad > 4) return "ללא צוות";
  return SQUAD_LABELS[squad - 1];
}

export function AdminRosterSection({ people, onChanged }: Props) {
  const [newName, setNewName] = useState("");
  const [bulkNames, setBulkNames] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("active");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const activePeople = useMemo(
    () => people.filter((p) => p.active !== false),
    [people],
  );
  const removedPeople = useMemo(
    () => people.filter((p) => p.active === false),
    [people],
  );

  const visible = useMemo(() => {
    const source = filter === "active" ? activePeople : removedPeople;
    const q = query.trim();
    const filtered = q
      ? source.filter(
          (p) =>
            p.name.includes(q) ||
            (p.email && p.email.toLowerCase().includes(q.toLowerCase())),
        )
      : source;
    return [...filtered].sort((a, b) => a.name.localeCompare(b.name, "he"));
  }, [activePeople, removedPeople, filter, query]);

  async function addPerson(e: FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setError("");
    setMessage("");
    const res = await fetch("/api/people", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(data.error || "שגיאה בהוספה");
      return;
    }
    setNewName("");
    setMessage(`${name} נוסף למחזור`);
    onChanged();
  }

  async function addBulk(e: FormEvent) {
    e.preventDefault();
    const names = bulkNames
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!names.length) return;
    setError("");
    setMessage("");
    let added = 0;
    const failures: string[] = [];
    for (const name of names) {
      const res = await fetch("/api/people", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (res.ok) added += 1;
      else {
        const data = await res.json().catch(() => ({}));
        failures.push(`${name}: ${data.error || "שגיאה"}`);
      }
    }
    setBulkNames("");
    if (failures.length) setError(failures.join(" · "));
    if (added) setMessage(`נוספו ${added} שמות`);
    onChanged();
  }

  async function setActive(person: Person, active: boolean) {
    const confirmText = active
      ? `להחזיר את ${person.name} לרשימת הפלוגה?`
      : `להסיר את ${person.name} מרשימת הפלוגה?\nלא יופיע בשיבוץ, בנטל ובדף הפלוגה. אפשר להחזיר אחר כך.`;
    if (!confirm(confirmText)) return;

    setBusyId(person.id);
    setError("");
    setMessage("");
    const res = await fetch("/api/people", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: person.id, active }),
    });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      setError(data.error || "שגיאה בעדכון");
      return;
    }
    setMessage(
      active
        ? `${person.name} הוחזר לפלוגה`
        : `${person.name} הוסר מהפלוגה`,
    );
    onChanged();
  }

  return (
    <section className="card mb-6">
      <h3 className="font-display text-base mb-2">
        מחזור ({activePeople.length})
      </h3>
      <p className="lede mb-3">
        הוספה והסרה של צוערים מהפלוגה. הסרה מסתירה מהשיבוץ ומהרשימות בלי למחוק
        היסטוריה — אפשר להחזיר בכל עת.
      </p>
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

      <div className="bar mt-4 mb-2 flex-wrap">
        <button
          type="button"
          className={`btn-sm ${filter === "active" ? "on" : ""}`}
          onClick={() => setFilter("active")}
        >
          בפלוגה ({activePeople.length})
        </button>
        <button
          type="button"
          className={`btn-sm ${filter === "removed" ? "on" : ""}`}
          onClick={() => setFilter("removed")}
        >
          הוסרו ({removedPeople.length})
        </button>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש לפי שם"
          className="flex-1 min-w-[10rem]"
          aria-label="חיפוש במחזור"
        />
      </div>

      {error && <p className="msg-err mt-2">{error}</p>}
      {message && <p className="msg-ok mt-2">{message}</p>}

      <div className="admin-roster" role="list" aria-label="רשימת המחזור">
        {visible.length === 0 ? (
          <p className="hint p-3">
            {filter === "removed" ? "אף אחד לא הוסר מהפלוגה" : "אין שמות"}
          </p>
        ) : (
          visible.map((p) => (
            <div
              key={p.id}
              className={`admin-roster-row${p.active === false ? " is-inactive" : ""}`}
              role="listitem"
            >
              <div className="admin-roster-meta">
                <b>
                  {p.name}
                  {(p.is_officer || p.is_admin) && (
                    <span className="hint"> · קצין תורן / מנהל</span>
                  )}
                </b>
                <p className="hint text-xs">
                  {squadLabel(p.squad)}
                  {p.email ? ` · ${p.email}` : ""}
                </p>
              </div>
              {p.active === false ? (
                <button
                  type="button"
                  className="btn-sm"
                  disabled={busyId === p.id}
                  onClick={() => setActive(p, true)}
                >
                  {busyId === p.id ? "מחזיר…" : "החזר לפלוגה"}
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-sm"
                  disabled={busyId === p.id}
                  onClick={() => setActive(p, false)}
                >
                  {busyId === p.id ? "מסיר…" : "הסר מהפלוגה"}
                </button>
              )}
            </div>
          ))
        )}
      </div>
      <p className="hint text-xs mt-2">
        קצינים תורנים: רני פלג, יסמין חדד — הרצו{" "}
        <code className="mono">migration_officer.sql</code> ב-Supabase לסימון ב-DB.
      </p>
    </section>
  );
}
