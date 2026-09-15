/**
 * Independent ABAS roster validator.
 *
 * Deliberately does NOT use scheduling-engine overlap helpers, mission-timeline.ts,
 * or resolveBaseWorkSlotInterval — so a shared conversion bug cannot hide here.
 */
import type { MissionDay, Person } from "@/lib/types";
import { isRestConstrainedGuardKind, resolvePositionKind } from "@/lib/mission-utils";
import { isBaseWorkPositionName, isBaseWorkShiftSlot } from "@/lib/base-work-template";

export type AbasValidationViolation = string;

const ABAS_WINDOWS = [
  ["08:30", "11:30"],
  ["13:30", "17:30"],
  ["18:30", "20:00"],
] as const;

function hm(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return null;
  const h = +m[1];
  const min = +m[2];
  if (h === 24 && min === 0) return 1440;
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function durMin(start: string, end: string): number {
  const a = hm(start);
  const b = hm(end);
  if (a == null || b == null) return 0;
  if (b > a) return b - a;
  if (b === a) return 1440;
  return 1440 - a + b;
}

function israelNoonMs(dateStr: string): number {
  return Date.parse(`${dateStr.slice(0, 10)}T12:00:00+03:00`);
}

function israelMidnightMs(dateStr: string): number {
  return Date.parse(`${dateStr.slice(0, 10)}T00:00:00+03:00`);
}

type Abs = { start: number; end: number; label: string; kind: string; name: string; isAbas: boolean; isGuard: boolean; isCarmelA: boolean; isCarmelB: boolean };

function isAbasWindow(start: string, end: string): boolean {
  const s = start.trim();
  const e = end.trim();
  return ABAS_WINDOWS.some(([a, b]) => a === s && b === e) || isBaseWorkShiftSlot(start, end);
}

function placeLabeledWindow(
  missionStart: number,
  missionEnd: number,
  missionDate: string,
  start: string,
  end: string,
  preferEarlyAbas: boolean,
): { start: number; end: number } | null {
  const startM = hm(start);
  const duration = durMin(start, end);
  if (startM == null || duration <= 0) return null;

  const midnight = israelMidnightMs(missionDate);
  const candidates: { start: number; end: number }[] = [];
  for (let day = -1; day <= 2; day++) {
    const startAbs = midnight + day * 86_400_000 + startM * 60_000;
    candidates.push({ start: startAbs, end: startAbs + duration * 60_000 });
  }

  if (preferEarlyAbas) {
    const leadOk = candidates.find((c) => {
      const lead = (missionStart - c.start) / 60_000;
      return lead >= 0 && lead <= 90 && c.end > missionStart;
    });
    if (leadOk) return leadOk;
  }

  const inside = candidates.find((c) => c.start >= missionStart && c.end <= missionEnd);
  if (inside) return inside;

  const overlap = candidates.find((c) => c.start < missionEnd && c.end > missionStart);
  return overlap ?? null;
}

function collectBlocks(mission: MissionDay): Map<string, Abs[]> {
  const missionStart = Date.parse(mission.starts_at);
  const missionEnd = Date.parse(mission.ends_at);
  const byPerson = new Map<string, Abs[]>();

  for (const pos of mission.positions || []) {
    const kind = resolvePositionKind(mission.mission_type, pos);
    const carmelA = kind === "standby_carmel_a";
    const carmelB = kind === "standby_carmel_b";
    const abasPos = isBaseWorkPositionName(pos.name) || mission.mission_type === "base_work";
    for (const slot of pos.slots || []) {
      const abas = abasPos || isAbasWindow(slot.start_time, slot.end_time);
      let bounds: { start: number; end: number } | null = null;
      if (carmelA || carmelB || slot.start_time === slot.end_time) {
        bounds = { start: missionStart, end: missionEnd };
      } else if (abas) {
        bounds = placeLabeledWindow(
          missionStart,
          missionEnd,
          mission.mission_date,
          slot.start_time,
          slot.end_time,
          true,
        );
      } else {
        bounds = placeLabeledWindow(
          missionStart,
          missionEnd,
          mission.mission_date,
          slot.start_time,
          slot.end_time,
          false,
        );
      }
      if (!bounds) continue;
      const seats = mission.assignments[slot.id] || [];
      for (const name of seats) {
        if (!name) continue;
        const list = byPerson.get(name) || [];
        list.push({
          start: bounds.start,
          end: bounds.end,
          label: `${pos.name} ${slot.start_time}–${slot.end_time}`,
          kind,
          name: pos.name,
          isAbas: abas,
          isGuard: isRestConstrainedGuardKind(kind) && !abas,
          isCarmelA: carmelA,
          isCarmelB: carmelB,
        });
        byPerson.set(name, list);
      }
    }
  }
  void israelNoonMs;
  return byPerson;
}

export type ValidateAbasRosterInput = {
  mission: MissionDay;
  people?: Person[];
  minGuardAbasRestMin?: number;
  minGuardGuardRestMin?: number;
  expectedAbasSeats?: number;
  originalAssignments?: Record<string, string[]>;
};

export function validateAbasRosterIndependent(
  input: ValidateAbasRosterInput,
): AbasValidationViolation[] {
  const mission = input.mission;
  const minAbas = input.minGuardAbasRestMin ?? 30;
  const expected = input.expectedAbasSeats ?? 20;
  const violations: AbasValidationViolation[] = [];

  const abasSlots: Array<{ id: string; start: string; end: string; seats: string[] }> = [];
  for (const pos of mission.positions || []) {
    if (
      !isBaseWorkPositionName(pos.name) &&
      mission.mission_type !== "base_work" &&
      !(pos.slots || []).some((s) => isAbasWindow(s.start_time, s.end_time))
    ) {
      continue;
    }
    for (const slot of pos.slots || []) {
      if (!isAbasWindow(slot.start_time, slot.end_time) && !isBaseWorkPositionName(pos.name)) continue;
      const seats = (mission.assignments[slot.id] || []).filter(Boolean);
      abasSlots.push({
        id: slot.id,
        start: slot.start_time,
        end: slot.end_time,
        seats,
      });
      const need = slot.seat_count || expected;
      if (seats.length !== need && isAbasWindow(slot.start_time, slot.end_time)) {
        violations.push(
          `ABAS ${slot.start_time}–${slot.end_time}: expected ${need} people, got ${seats.length}`,
        );
      }
      if (new Set(seats).size !== seats.length) {
        violations.push(`ABAS ${slot.start_time}–${slot.end_time}: duplicate person in shift`);
      }
    }
  }

  if (input.originalAssignments) {
    for (const pos of mission.positions || []) {
      const abasPos = isBaseWorkPositionName(pos.name);
      for (const slot of pos.slots || []) {
        if (abasPos || isAbasWindow(slot.start_time, slot.end_time)) continue;
        const orig = input.originalAssignments[slot.id] || [];
        const now = mission.assignments[slot.id] || [];
        const n = Math.max(orig.length, now.length);
        for (let i = 0; i < n; i++) {
          if ((orig[i] || "") !== (now[i] || "")) {
            violations.push(
              `Fixed assignment changed at ${pos.name} ${slot.start_time}–${slot.end_time} seat ${i}: "${orig[i] || ""}" → "${now[i] || ""}"`,
            );
          }
        }
      }
    }
  }

  const noBase = new Set(
    (input.people || []).filter((p) => p.no_base_work).map((p) => p.name),
  );
  for (const slot of abasSlots) {
    for (const name of slot.seats) {
      if (noBase.has(name)) {
        violations.push(`${name}: assigned to ABAS ${slot.start}–${slot.end} despite no_base_work`);
      }
    }
  }

  const blocks = collectBlocks(mission);
  for (const [person, list] of blocks) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const overlap = a.start < b.end && b.start < a.end;
        const idle =
          overlap ? 0 : a.end <= b.start ? (b.start - a.end) / 60_000 : (a.start - b.end) / 60_000;

        if (a.isCarmelA && b.isAbas) {
          violations.push(`${person}: ABAS during כרמל א׳ (${b.label})`);
          continue;
        }
        if (b.isCarmelA && a.isAbas) {
          violations.push(`${person}: ABAS during כרמל א׳ (${a.label})`);
          continue;
        }
        if ((a.isCarmelB && b.isAbas) || (b.isCarmelB && a.isAbas)) {
          continue;
        }

        if (overlap && !(a.kind === "patrol" && b.kind === "officer_duty") && !(b.kind === "patrol" && a.kind === "officer_duty")) {
          violations.push(`${person}: overlap ${a.label} ∩ ${b.label}`);
        }

        if ((a.isGuard && b.isAbas) || (b.isGuard && a.isAbas)) {
          if (overlap || idle + 1e-9 < minAbas) {
            violations.push(
              `${person}: guard↔ABAS rest ${overlap ? "overlap" : `${Math.round(idle)} min`} < ${minAbas} (${a.label} / ${b.label})`,
            );
          }
        }
      }
    }
  }

  return [...new Set(violations)];
}
