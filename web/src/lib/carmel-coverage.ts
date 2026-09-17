import { isStandbyKind } from "@/lib/mission-utils";
import {
  fmtMissionTimeLabel,
  intervalsOverlap,
  materializeSlotAbsoluteBounds,
  normalizeTimeLabel,
  parseTimeMinutes,
  resolveCanonicalSlotInterval,
  resolveSlotAbsoluteInterval,
  type TimeInterval,
} from "@/lib/time-interval";
import type { MissionDay, MissionSlot } from "@/lib/types";

const MIN_PIECE_MS = 60_000;

function clockLabel(value: string): string {
  const raw = String(value || "").trim();
  const withSeconds = /^(\d{1,2}):(\d{2}):\d{2}$/.exec(raw);
  return normalizeTimeLabel(withSeconds ? `${withSeconds[1]}:${withSeconds[2]}` : raw);
}

function subtractInterval(slot: TimeInterval, hole: TimeInterval): TimeInterval[] {
  if (!intervalsOverlap(slot, hole)) return [slot];
  const out: TimeInterval[] = [];
  if (slot.startMs < hole.startMs) {
    const endMs = Math.min(slot.endMs, hole.startMs);
    if (endMs - slot.startMs >= MIN_PIECE_MS) {
      out.push({ startMs: slot.startMs, endMs });
    }
  }
  if (hole.endMs < slot.endMs) {
    const startMs = Math.max(slot.startMs, hole.endMs);
    if (slot.endMs - startMs >= MIN_PIECE_MS) {
      out.push({ startMs, endMs: slot.endMs });
    }
  }
  return out;
}

function slotFromInterval(base: MissionSlot, id: string, iv: TimeInterval): MissionSlot {
  const start_time = fmtMissionTimeLabel(iv.startMs);
  const end_time = fmtMissionTimeLabel(iv.endMs);
  const next: MissionSlot = {
    id,
    start_time,
    end_time,
    seat_count: base.seat_count,
    ...materializeSlotAbsoluteBounds({ start_time, end_time }, iv),
  };
  if (base.label) next.label = base.label;
  return next;
}

export type PunchCarmelCoverageHoleResult =
  | {
      ok: true;
      mission: MissionDay;
      startTime: string;
      endTime: string;
      createdSlotIds: string[];
      removedSlotIds: string[];
    }
  | { ok: false; error: string };

/**
 * Removes a wall-clock range from כרמל א׳ and כרמל ב׳ coverage.
 * Remaining pieces keep the same assignees and continue after the hole.
 */
export function punchCarmelCoverageHole(
  mission: MissionDay,
  startTime: string,
  endTime: string,
): PunchCarmelCoverageHoleResult {
  if (mission.mission_type !== "guards") {
    return { ok: false, error: "חור בכרמל זמין רק ביום שמירות" };
  }
  const start = clockLabel(startTime);
  const end = clockLabel(endTime);
  if (parseTimeMinutes(start) === null || parseTimeMinutes(end) === null) {
    return { ok: false, error: "שעות לא תקינות" };
  }
  if (start === end) {
    return { ok: false, error: "שעת ההתחלה והסיום לא יכולות להיות זהות" };
  }

  const hole = resolveSlotAbsoluteInterval(mission.starts_at, mission.ends_at, start, end);
  if (!hole) {
    return { ok: false, error: "הטווח לא נמצא ביום המשימה" };
  }

  const assignments = { ...mission.assignments };
  const lockedSeats = { ...(mission.locked_seats || {}) };
  const createdSlotIds: string[] = [];
  const removedSlotIds: string[] = [];
  let changed = false;

  const positions = mission.positions.map((pos) => {
    if (!pos.kind || !isStandbyKind(pos.kind)) return pos;

    const nextSlots: MissionSlot[] = [];
    for (const slot of pos.slots) {
      const slotIv = resolveCanonicalSlotInterval(mission, slot);
      if (!slotIv) {
        nextSlots.push(slot);
        continue;
      }
      const pieces = subtractInterval(slotIv, hole);
      if (pieces.length === 1 && pieces[0].startMs === slotIv.startMs && pieces[0].endMs === slotIv.endMs) {
        nextSlots.push(slot);
        continue;
      }
      changed = true;
      if (!pieces.length) {
        removedSlotIds.push(slot.id);
        delete assignments[slot.id];
        delete lockedSeats[slot.id];
        continue;
      }
      pieces.forEach((piece, index) => {
        const id = index === 0 ? slot.id : crypto.randomUUID();
        nextSlots.push(slotFromInterval(slot, id, piece));
        if (id !== slot.id) {
          createdSlotIds.push(id);
          if (assignments[slot.id]) assignments[id] = [...assignments[slot.id]];
          if (lockedSeats[slot.id]) lockedSeats[id] = [...lockedSeats[slot.id]];
        }
      });
    }

    nextSlots.sort((a, b) => {
      const aMs = resolveCanonicalSlotInterval(mission, a)?.startMs ?? 0;
      const bMs = resolveCanonicalSlotInterval(mission, b)?.startMs ?? 0;
      return aMs - bMs;
    });
    return { ...pos, slots: nextSlots };
  });

  if (!changed) {
    return { ok: false, error: "אין כיסוי כרמל בטווח השעות הזה" };
  }

  const stillCovered = positions.some(
    (pos) => pos.kind && isStandbyKind(pos.kind) && pos.slots.length > 0,
  );
  if (!stillCovered) {
    return { ok: false, error: "הטווח מכסה את כל כוננות כרמל — השאירו לפחות מקטע אחד" };
  }

  return {
    ok: true,
    mission: {
      ...mission,
      positions,
      assignments,
      locked_seats: lockedSeats,
    },
    startTime: start,
    endTime: end,
    createdSlotIds,
    removedSlotIds,
  };
}
