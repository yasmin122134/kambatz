"use client";

import { useRef, useState } from "react";
import type { MissionDay } from "@/lib/types";

type Props = {
  className?: string;
  label?: string;
  onImported?: (mission: MissionDay) => void;
};

export function LuachXlsxImportButton({
  className = "btn-sm",
  label = "ייבוא מאקסל",
  onImported,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File) {
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/missions/import-xlsx", { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(data.error || "שגיאה בייבוא האקסל");
        return;
      }
      const mission = data.mission as MissionDay;
      const unmatched = (data.unmatchedNames as string[]) || [];
      const extra = unmatched.length
        ? `\nשמות שלא במחזור: ${unmatched.slice(0, 8).join(", ")}${unmatched.length > 8 ? "…" : ""}`
        : "";
      alert(
        `יובאו ${data.assignedSeatCount ?? 0} שיבוצים ל־${mission.mission_date}.${extra}`,
      );
      onImported?.(mission);
    } catch {
      alert("שגיאה בייבוא האקסל");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFile(file);
        }}
      />
      <button
        type="button"
        className={className}
        disabled={busy}
        title="ייבוא יום שמירות מקובץ לוח מאומת (xlsx)"
        onClick={() => inputRef.current?.click()}
      >
        {busy ? "מייבא…" : label}
      </button>
    </>
  );
}
