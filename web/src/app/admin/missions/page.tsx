"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/AppShell";
import {
  MISSION_STATUS_LABELS,
  MISSION_TYPE_LABELS,
  type MissionDay,
} from "@/lib/types";

export default function AdminMissionsPage() {
  const [missions, setMissions] = useState<MissionDay[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch("/api/missions");
    if (res.ok) setMissions(await res.json());
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function remove(id: string) {
    if (!confirm("למחוק יום משימה?")) return;
    await fetch(`/api/missions/${id}`, { method: "DELETE" });
    load();
  }

  function formatDate(d: string) {
    return new Date(d + "T12:00:00").toLocaleDateString("he-IL", {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }

  return (
    <AppShell title="ימי משימה">
      <main className="mx-auto max-w-3xl px-5 py-8">
        <div className="bar spread mb-6">
          <h2 className="font-display text-xl">ימי משימה</h2>
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/missions/new?type=guards" className="btn-pri btn-sm">
              + הוסף יום שמירה
            </Link>
            <Link href="/admin/missions/new?type=kitchen" className="btn-sm">
              + מטבח
            </Link>
            <Link href="/admin/missions/new?type=base_work" className="btn-sm">
              + עב״ס
            </Link>
          </div>
        </div>

        {loading ? (
          <p className="hint">טוען…</p>
        ) : missions.length === 0 ? (
          <div className="card">
            <p className="hint mb-3">אין ימי משימה. צרו את הראשון.</p>
            <Link href="/admin/missions/new?type=guards" className="btn-pri btn-sm">
              הוסף יום שמירה
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {missions.map((m) => (
              <li key={m.id} className="card bar spread flex-wrap gap-3">
                <div>
                  <b>{m.title}</b>
                  <p className="hint text-sm mt-1">
                    {formatDate(m.mission_date)} · {MISSION_TYPE_LABELS[m.mission_type]} ·{" "}
                    <span className={`tag tag-${m.status === "published" ? "approved" : "pending"}`}>
                      {MISSION_STATUS_LABELS[m.status]}
                    </span>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link href={`/admin/missions/${m.id}`} className="btn-sm">
                    ערוך
                  </Link>
                  <Link href={`/board`} className="btn-sm">
                    לוח
                  </Link>
                  <button type="button" className="btn-sm" onClick={() => remove(m.id)}>
                    מחק
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6">
          <Link href="/admin" className="btn-sm">
            ← דף מנהל
          </Link>
        </div>
      </main>
    </AppShell>
  );
}
