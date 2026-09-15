import type { MissionPosition, MissionSlot } from "@/lib/types";
import {
  localMissionMidnightMs,
  materializeSlotAbsoluteBounds,
  normalizeTimeLabel,
  parseIsoMs,
  parseTimeMinutes,
  resolveCanonicalSlotInterval,
  slotDurationMinutes,
  type TimeInterval,
} from "@/lib/time-interval";

function uid() {
  return crypto.randomUUID();
}

export type PatrolAssigneeRole = "company_commander" | "duty_officer";

export type PatrolTourDef = {
  label: string;
  start: string;
  end: string;
  assigneeRole: PatrolAssigneeRole;
};

/** סיורים לפי הפקודה — שעות קיר על תאריך יום המשימה */
export const DEFAULT_PATROL_TOURS: PatrolTourDef[] = [
  {
    label: "סיור פנים גדר",
    start: "09:30",
    end: "10:00",
    assigneeRole: "duty_officer",
  },
  {
    label: "סיור פנים גדר + סבב עמדות",
    start: "13:00",
    end: "13:30",
    assigneeRole: "duty_officer",
  },
  {
    label: "זמן גשר יזומות + סבב עמדות + גדר היקפית",
    start: "18:30",
    end: "19:30",
    assigneeRole: "duty_officer",
  },
  {
    label: "סיור פנים גדר + חתימות",
    start: "23:00",
    end: "23:30",
    assigneeRole: "duty_officer",
  },
  {
    label: "סיור פנים גדר + חתימות",
    start: "02:00",
    end: "02:30",
    assigneeRole: "duty_officer",
  },
  {
    label: "סבב עמדות + גדר היקפית",
    start: "05:00",
    end: "06:00",
    assigneeRole: "duty_officer",
  },
];

export function patrolWindowKey(start: string, end: string): string {
  return `${normalizeTimeLabel(start)}-${normalizeTimeLabel(end)}`;
}

const PATROL_ROLE_BY_WINDOW = new Map(
  DEFAULT_PATROL_TOURS.map((t) => [patrolWindowKey(t.start, t.end), t.assigneeRole]),
);

export function patrolAssigneeRole(start: string, end: string): PatrolAssigneeRole | null {
  return PATROL_ROLE_BY_WINDOW.get(patrolWindowKey(start, end)) ?? null;
}

export const PATROL_ASSIGNEE_ROLE_LABELS: Record<PatrolAssigneeRole, string> = {
  company_commander: "ככ״א",
  duty_officer: "קצין תורן",
};

export function patrolAssigneeRoleLabel(role: PatrolAssigneeRole): string {
  return PATROL_ASSIGNEE_ROLE_LABELS[role];
}

export function isPatrolPositionName(name: string): boolean {
  return name.trim().includes("פטרול");
}

export function isPatrolPosition(pos: Pick<MissionPosition, "name" | "kind">): boolean {
  return pos.kind === "patrol" || isPatrolPositionName(pos.name);
}

export function isPatrolShiftSlot(startTime: string, endTime: string): boolean {
  return PATROL_ROLE_BY_WINDOW.has(patrolWindowKey(startTime, endTime));
}

/** שעות קבועות על תאריך mission_date (כמו עב״ס). */
export function patrolWallClockInterval(
  missionDate: string,
  startTime: string,
  endTime: string,
): TimeInterval | null {
  const startMin = parseTimeMinutes(normalizeTimeLabel(startTime));
  const durMin = slotDurationMinutes(startTime, endTime);
  if (startMin === null || durMin <= 0) return null;

  const date = missionDate.slice(0, 10);
  const anchor = parseIsoMs(`${date}T12:00:00+03:00`);
  if (anchor === null) return null;

  const midnight = localMissionMidnightMs(anchor);
  const startMs = midnight + startMin * 60_000;
  const endMs = startMs + durMin * 60_000;
  if (endMs <= startMs) return null;
  return { startMs, endMs };
}

/** פטרולים על ציר יום השמירות (כמו הלוח, עב״ס וחמגשיות). */
export function resolvePatrolSlotInterval(
  missionDate: string,
  missionStartsAt: string,
  missionEndsAt: string,
  slot: { start_time: string; end_time: string; starts_at?: string; ends_at?: string },
): TimeInterval | null {
  const canonical = resolveCanonicalSlotInterval(
    { starts_at: missionStartsAt, ends_at: missionEndsAt },
    slot,
  );
  if (canonical) return canonical;
  return patrolWallClockInterval(missionDate, slot.start_time, slot.end_time);
}

function materializePatrolSlot(
  missionDate: string,
  tour: PatrolTourDef,
  existing?: MissionSlot,
  missionWindow?: { startsAt: string; endsAt: string },
): MissionSlot {
  const slot: MissionSlot = {
    id: existing?.id ?? uid(),
    start_time: tour.start,
    end_time: tour.end,
    seat_count: existing?.seat_count ?? 1,
    label: tour.label,
  };
  const abs = missionWindow
    ? resolvePatrolSlotInterval(
        missionDate,
        missionWindow.startsAt,
        missionWindow.endsAt,
        slot,
      )
    : patrolWallClockInterval(missionDate, tour.start, tour.end);
  if (abs) {
    Object.assign(slot, materializeSlotAbsoluteBounds(slot, abs));
  }
  return slot;
}

export function materializePatrolPositions(
  positions: MissionPosition[],
  missionDate?: string,
  missionWindow?: { startsAt: string; endsAt: string },
): MissionPosition[] {
  const date = missionDate ?? new Date().toISOString().slice(0, 10);
  return positions.map((pos) =>
    isPatrolPosition(pos)
      ? {
          ...pos,
          kind: "patrol" as const,
          slots: pos.slots.map((slot, i) => {
            const tour =
              DEFAULT_PATROL_TOURS.find(
                (t) =>
                  patrolWindowKey(t.start, t.end) ===
                  patrolWindowKey(slot.start_time, slot.end_time),
              ) ?? DEFAULT_PATROL_TOURS[i];
            return tour ? materializePatrolSlot(date, tour, slot, missionWindow) : slot;
          }),
        }
      : pos,
  );
}

export function defaultPatrolPositions(options?: {
  tours?: PatrolTourDef[];
  missionDate?: string;
  missionStartsAt?: string;
  missionEndsAt?: string;
}): MissionPosition[] {
  const tours = options?.tours ?? DEFAULT_PATROL_TOURS;
  const missionDate = options?.missionDate ?? new Date().toISOString().slice(0, 10);
  const missionWindow =
    options?.missionStartsAt && options?.missionEndsAt
      ? { startsAt: options.missionStartsAt, endsAt: options.missionEndsAt }
      : undefined;
  return [
    {
      id: uid(),
      name: "פטרולים",
      kind: "patrol",
      slots: tours.map((t) => materializePatrolSlot(missionDate, t, undefined, missionWindow)),
    },
  ];
}
