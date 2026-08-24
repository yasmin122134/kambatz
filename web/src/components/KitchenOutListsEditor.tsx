"use client";

import { useCallback, useState } from "react";
import { NameCombobox } from "@/components/NameCombobox";
import {
  buildKitchenOutNamesFromSquads,
  KITCHEN_SHIFT_COUNT,
  normalizeKitchenOutNamesByShift,
} from "@/lib/kitchen-out-lists";
import { DEFAULT_KITCHEN_SHIFTS } from "@/lib/kitchen-day-template";
import type { KitchenSchedulingRules, Person } from "@/lib/types";
import { DEFAULT_KITCHEN_SCHEDULING_RULES } from "@/lib/types";

type Props = {
  kitchen: KitchenSchedulingRules;
  onChange: (kitchen: KitchenSchedulingRules) => void;
  shiftLabels?: string[];
};

export function KitchenOutListsEditor({ kitchen, onChange, shiftLabels }: Props) {
  const lists = normalizeKitchenOutNamesByShift(kitchen.out_names_by_shift);
  const labels =
    shiftLabels ??
    DEFAULT_KITCHEN_SHIFTS.map((s) =>
      s.label ? `${s.start}–${s.end} (${s.label})` : `${s.start}–${s.end}`,
    );

  const updateLists = useCallback(
    (next: string[][]) => {
      onChange({ ...kitchen, out_names_by_shift: next });
    },
    [kitchen, onChange],
  );

  const addName = (shiftIndex: number, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const next = lists.map((row, i) =>
      i === shiftIndex
        ? [...new Set([...row, trimmed])].sort((a, b) => a.localeCompare(b, "he"))
        : row,
    );
    updateLists(next);
  };

  const removeName = (shiftIndex: number, name: string) => {
    const next = lists.map((row, i) =>
      i === shiftIndex ? row.filter((n) => n !== name) : row,
    );
    updateLists(next);
  };

  const fillFromSquads = async () => {
    const res = await fetch("/api/people");
    const data = (await res.json()) as Person[];
    if (!Array.isArray(data)) return;
    const active = data.filter((p) => p.active !== false);
    const base = {
      ...DEFAULT_KITCHEN_SCHEDULING_RULES,
      ...kitchen,
    };
    updateLists(buildKitchenOutNamesFromSquads(base, active));
  };

  const clearAll = () => {
    updateLists(Array.from({ length: KITCHEN_SHIFT_COUNT }, () => []));
  };

  return (
    <div className="kitchen-out-lists stack gap-3">
      <div className="rowf items-end gap-2 flex-wrap">
        <strong className="text-sm">רשימות «בחוץ» לפי משמרת</strong>
        <button type="button" className="btn-sm" onClick={() => void fillFromSquads()}>
          מלא לפי צוותים במנוחה
        </button>
        <button type="button" className="btn-sm" onClick={clearAll}>
          נקה רשימות
        </button>
      </div>
      <p className="hint text-xs">
        צוערים ברשימה לא ישובצו למשמרת זו. אם הרשימות ריקות — השיבוץ משתמש בצוות המנוחה
        מההגדרות למעלה. אחרי עדכון — שמרו את המשימה והריצו שיבוץ חכם.
      </p>
      {Array.from({ length: KITCHEN_SHIFT_COUNT }, (_, shiftIndex) => (
        <div key={shiftIndex} className="card pad-sm stack gap-2">
          <div className="text-sm font-medium">
            משמרת {shiftIndex + 1}: {labels[shiftIndex] ?? ""}
            <span className="hint font-normal mr-2">
              ({lists[shiftIndex].length} בחוץ)
            </span>
          </div>
          <div className="rowf gap-2 items-start flex-wrap">
            <div className="field flex-1 min-w-[12rem]">
              <label className="sr-only">הוסף שם</label>
              <OutNamePicker
                onPick={(name) => {
                  addName(shiftIndex, name);
                }}
              />
            </div>
          </div>
          {lists[shiftIndex].length > 0 && (
            <ul className="flex flex-wrap gap-1 list-none p-0 m-0">
              {lists[shiftIndex].map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    className="btn-sm tag"
                    title="הסר מהרשימה"
                    onClick={() => removeName(shiftIndex, name)}
                  >
                    {name} ×
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function OutNamePicker({ onPick }: { onPick: (name: string) => void }) {
  const [draft, setDraft] = useState("");
  return (
    <div className="rowf gap-2">
      <NameCombobox
        value={draft}
        onChange={setDraft}
        placeholder="הוסף צוער לרשימת בחוץ…"
        className="flex-1"
      />
      <button
        type="button"
        className="btn-sm"
        onClick={() => {
          onPick(draft);
          setDraft("");
        }}
      >
        הוסף
      </button>
    </div>
  );
}
